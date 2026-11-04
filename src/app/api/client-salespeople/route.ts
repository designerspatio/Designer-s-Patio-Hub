import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "hub-client-salespeople";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function context(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new RequestError("Please sign in again.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUBABASE_SERVICE_ROLE_KEY;
  if (!url || !publicKey || !serviceKey) throw new RequestError("Shared client assignments are not configured on this server.", 503);
  const auth = createClient(url, publicKey, options);
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) throw new RequestError("Please sign in again.", 401);
  const admin = createClient(url, serviceKey, options);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,active").eq("id", user.id).single();
  if (profileError || !profile || profile.active !== true) throw new RequestError("An active Hub account is required.", 403);
  return admin;
}

function notFound(error: { status?: number; statusCode?: string | number; message?: string }) {
  return String(error.statusCode || error.status) === "404" ||
    /not found|does not exist/i.test(error.message || "");
}

async function storage(admin: SupabaseClient) {
  let { data, error } = await admin.storage.getBucket(BUCKET);
  if (error && notFound(error)) {
    const result = await admin.storage.createBucket(BUCKET, {
      public: false, fileSizeLimit: 4096, allowedMimeTypes: ["application/json"],
    });
    if (result.error && !/already exists|duplicate/i.test(result.error.message))
      throw new RequestError("Could not initialize shared client assignment storage.", 503);
    const refreshed = await admin.storage.getBucket(BUCKET);
    data = refreshed.data; error = refreshed.error;
  }
  if (error || !data || data.public) throw new RequestError("Private client assignment storage is unavailable.", 503);
  return admin.storage.from(BUCKET);
}

function errorResponse(error: unknown) {
  return error instanceof RequestError
    ? reply({ error: error.message }, error.status)
    : reply({ error: "Could not access shared client assignments. Please try again." }, 503);
}

// Additional salespeople are separate from clients.assigned_user_id, the existing primary owner.
// Each client has its own private object so imports and edits of other clients cannot overwrite it.
export async function GET(request: Request) {
  try {
    const bucket = await storage(await context(request));
    const assignments: Record<string, string[]> = {};
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list("assignments", {
        limit: 100, offset, sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new RequestError("Could not list shared assignments.", 503);
      const files = (data || []).filter(file => UUID.test(file.name.replace(/\.json$/i, "")) && /\.json$/i.test(file.name));
      for (let i = 0; i < files.length; i += 20) {
        const batch = await Promise.all(files.slice(i, i + 20).map(async file => {
          const { data: blob, error: downloadError } = await bucket.download("assignments/" + file.name);
          if (downloadError || !blob) throw new RequestError("Could not read shared client assignments.", 503);
          const parsed: unknown = JSON.parse(await blob.text());
          if (!parsed || !Array.isArray((parsed as { additional_user_ids?: unknown }).additional_user_ids))
            throw new RequestError("A shared client assignment is invalid.", 503);
          const ids = (parsed as { additional_user_ids: unknown[] }).additional_user_ids;
          if (!ids.every(id => typeof id === "string" && UUID.test(id)))
            throw new RequestError("A shared client assignment contains an invalid user.", 503);
          return { clientId: file.name.slice(0, -5), ids: [...new Set(ids as string[])] };
        }));
        for (const item of batch) assignments[item.clientId] = item.ids;
      }
      if (!data || data.length < 100) break;
      if (offset >= 9900) throw new RequestError("Too many shared client records.", 503);
    }
    return reply({ assignments });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const admin = await context(request);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new RequestError("Invalid assignment request.", 400);
    const values = body as { client_id?: unknown; additional_user_ids?: unknown };
    const clientId = values.client_id;
    const ids = values.additional_user_ids;
    if (typeof clientId !== "string" || !UUID.test(clientId) || !Array.isArray(ids) || ids.length > 20 ||
      !ids.every(id => typeof id === "string" && UUID.test(id)))
      throw new RequestError("Choose a client and up to 20 valid salespeople.", 400);
    const uniqueIds = [...new Set(ids as string[])];

    const { data: client, error: clientError } = await admin.from("clients")
      .select("id,assigned_user_id").eq("id", clientId).single();
    if (clientError || !client) throw new RequestError("The selected client could not be found.", 404);
    if (uniqueIds.includes(client.assigned_user_id)) throw new RequestError("The primary salesperson cannot also be an additional salesperson.", 400);
    if (uniqueIds.length) {
      const { data: profiles, error: profilesError } = await admin.from("profiles")
        .select("id,active").in("id", uniqueIds);
      if (profilesError || (profiles || []).filter(person => person.active === true).length !== uniqueIds.length)
        throw new RequestError("Choose active Hub team members for additional salespeople.", 400);
    }
    const bucket = await storage(admin);
    const path = "assignments/" + clientId + ".json";
    if (!uniqueIds.length) {
      const { error: removeError } = await bucket.remove([path]);
      if (removeError && !notFound(removeError)) throw new RequestError("Could not clear additional salespeople.", 503);
    } else {
      const { error: uploadError } = await bucket.upload(
        path, JSON.stringify({ additional_user_ids: uniqueIds, updated_at: new Date().toISOString() }),
        { contentType: "application/json", upsert: true, cacheControl: "0" });
      if (uploadError) throw new RequestError("Could not save additional salespeople.", 503);
    }
    return reply({ client_id: clientId, additional_user_ids: uniqueIds });
  } catch (error) { return errorResponse(error); }
}
