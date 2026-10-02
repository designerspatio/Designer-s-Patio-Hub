import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { emptyWorkspace, parseWorkspace } from "../../crmWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "hub-private-workspaces";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
class HttpError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function missing(error: { status?: number; statusCode?: string | number; message?: string }) {
  return String(error.statusCode || error.status) === "404" || /not found|does not exist/i.test(error.message || "");
}
async function context(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError("Please sign in again.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !serviceKey) throw new HttpError("Personal workspace saving is not configured. Ask your Hub administrator to check the server's Supabase settings.", 503);
  const auth = createClient(url, key, options);
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) throw new HttpError("Please sign in again.", 401);
  const admin = createClient(url, serviceKey, options);
  const { data: profile, error: profileError } = await admin.from("profiles").select("id,active").eq("id", user.id).single();
  if (profileError) throw new HttpError("Unable to verify your Hub profile. Please try again.", 503);
  if (!profile || profile.active !== true) throw new HttpError("An active Hub account is required.", 403);
  // All paths derive from the verified user, never a client-supplied account ID.
  return { admin, userId: user.id };
}
async function bucketFor(admin: SupabaseClient) {
  let { data, error } = await admin.storage.getBucket(BUCKET);
  if (error && missing(error)) {
    const created = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 262144, allowedMimeTypes: ["application/json"] });
    // Another user's first request may have created it concurrently.
    if (created.error && !/already exists|duplicate/i.test(created.error.message)) throw new Error("Workspace storage is unavailable.");
    const result = await admin.storage.getBucket(BUCKET);
    data = result.data; error = result.error;
  }
  if (error || !data || data.public) throw new Error("Private workspace storage is unavailable.");
  return admin.storage.from(BUCKET);
}
async function readWorkspace(bucket: Awaited<ReturnType<typeof bucketFor>>, userId: string) {
  const { data: files, error } = await bucket.list(userId, { limit: 1, sortBy: { column: "name", order: "desc" } });
  if (error) throw new Error("Unable to load your workspace.");
  if (!files?.length) return emptyWorkspace();
  const { data, error: downloadError } = await bucket.download(`${userId}/${files[0].name}`);
  if (downloadError || !data) throw new Error("Unable to load your saved workspace.");
  return parseWorkspace(JSON.parse(await data.text()));
}
function failure(error: unknown) {
  return error instanceof HttpError ? json({ error: error.message }, error.status)
    : json({ error: "Your workspace could not be saved or loaded. Your on-screen changes have been kept; please retry." }, 503);
}
export async function GET(request: Request) {
  try {
    const { admin, userId } = await context(request);
    const bucket = await bucketFor(admin);
    return json({ workspace: await readWorkspace(bucket, userId) });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    const { admin, userId } = await context(request);
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 250000) return json({ error: "Workspace is too large. Remove older completed tasks or shorten the notepad." }, 413);
    let proposed;
    try { proposed = parseWorkspace(JSON.parse(raw)); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid workspace." }, 400); }
    const bucket = await bucketFor(admin);
    const current = await readWorkspace(bucket, userId);
    if (current.version !== proposed.version) return json({ error: "Another tab or device saved changes. Load the latest workspace before saving again." }, 409);
    const next = { ...proposed, version: proposed.version + 1 };
    // Immutable numbered revisions make simultaneous writes to the same version
    // conflict atomically rather than silently overwriting another device's work.
    const path = `${userId}/${String(next.version).padStart(12, "0")}.json`;
    const { error } = await bucket.upload(path, JSON.stringify(next), { contentType: "application/json", cacheControl: "0", upsert: false });
    if (error) {
      if (/already exists|duplicate/i.test(error.message) || String(error.statusCode) === "409") return json({ error: "Another tab or device saved changes. Load the latest workspace before saving again." }, 409);
      throw error;
    }
    // Bound snapshot storage without ever deleting the current revision. Cleanup
    // failure must not turn an already successful save into an apparent failure.
    try {
      const old = await bucket.list(userId, { limit: 100, offset: 20, sortBy: { column: "name", order: "desc" } });
      const paths = (old.data || []).filter(file => /^\d{12}\.json$/.test(file.name) && Number(file.name.slice(0, 12)) <= next.version - 20).map(file => `${userId}/${file.name}`);
      if (paths.length) await bucket.remove(paths);
    } catch { /* A later save can retry retention cleanup. */ }
    return json({ workspace: next });
  } catch (error) { return failure(error); }
}
