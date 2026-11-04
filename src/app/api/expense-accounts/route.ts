import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateExpenseAccount, type ExpenseAccount, type ExpenseAccountDraft } from "../../financeAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "hub-finance-account-catalog";
const FOLDER = "expense-accounts";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const json = (body: unknown, status=200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
class HttpError extends Error { constructor(message: string, public status: number) {super(message);} }
const notFound = (error: {status?:number; statusCode?:number|string;message?:string}) =>
  String(error.statusCode || error.status) === "404" || /not found|does not exist/i.test(error.message || "");

async function context(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError("Sign in to access expense accounts.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUBABASE_SERVICE_ROLE_KEY;
  if (!url || !publishable || !serviceKey) throw new HttpError("Expense account storage is not configured.", 503);
  const auth = createClient(url, publishable, options);
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) throw new HttpError("Sign in again to access expense accounts.", 401);
  const admin = createClient(url, serviceKey, options);
  const result = await admin.from("profiles").select("id,display_name,role,active").eq("id",user.id).single();
  if (result.error || !result.data) throw new HttpError("Unable to verify your Hub role.",503);
  const profile = result.data;
  if (!profile.active) throw new HttpError("Only active Hub members can access expense accounts.",403);
  const permitted = ["Owner","Manager","Assistant Manager","Shipping / Accounting"].includes(profile.role) ||
    /\b(pamela|accounting\s+team)\b/i.test(profile.display_name || "");
  if (!permitted) throw new HttpError("Expense account management is limited to the finance team.",403);
  return { admin };
}
async function bucketFor(admin:SupabaseClient) {
  let {data,error} = await admin.storage.getBucket(BUCKET);
  if(error && notFound(error)) {
    const created = await admin.storage.createBucket(BUCKET,{public:false,fileSizeLimit:131072,allowedMimeTypes:["application/json"]});
    if(created.error && !/already exists|duplicate/i.test(created.error.message)) throw new Error("Private finance account storage is unavailable.");
    ({data,error}=await admin.storage.getBucket(BUCKET));
  }
  if(error || !data || data.public) throw new Error("Private finance account storage is unavailable.");
  return admin.storage.from(BUCKET);
}
type Catalog={version:number; accounts:ExpenseAccount[]};
async function readCatalog(bucket:Awaited<ReturnType<typeof bucketFor>>):Promise<Catalog> {
  const {data,error} = await bucket.list(FOLDER,{limit:1,sortBy:{column:"name",order:"desc"}});
  if(error) throw new Error("Could not read saved expense accounts.");
  if(!data?.length)return {version:0,accounts:[]};
  const {data:file,error:downloadError}=await bucket.download(`${FOLDER}/${data[0].name}`);
  if(downloadError || !file) throw new Error("Could not read saved expense accounts.");
  const parsed=JSON.parse(await file.text()) as Catalog;
  if(!Number.isSafeInteger(parsed.version) || !Array.isArray(parsed.accounts)) throw new Error("Saved expense account catalog is invalid.");
  return parsed;
}
function failure(error:unknown){
  return error instanceof HttpError ? json({error:error.message},error.status) :
    json({error:"Expense accounts could not be loaded or saved. Your previous accounts have not been changed."},503);
}
export async function GET(request:Request) {
  try {
    const {admin}=await context(request);
    const bucket=await bucketFor(admin);
    return json(await readCatalog(bucket));
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try{
    const {admin}=await context(request);
    const raw=await request.text();
    if(Buffer.byteLength(raw,"utf8")>1500)return json({error:"Account details are too long."},413);
    let body:{version?:number;account?:ExpenseAccountDraft};
    try{body=JSON.parse(raw);}catch{return json({error:"Invalid account request."},400);}
    if(!body?.account || typeof body.account.name!=="string" || typeof body.account.payee!=="string" || typeof body.account.category!=="string" || !Number.isSafeInteger(body.version) || Number(body.version)<0)
      return json({error:"Enter an account name, payee, category, and valid version."},400);
    const bucket=await bucketFor(admin);
    const current=await readCatalog(bucket);
    if(body.version!==current.version)return json({error:"Another team member changed the expense accounts. Refresh and retry."},409);
    const validation=validateExpenseAccount(body.account,current.accounts);
    if(validation)return json({error:validation},400);
    const account:ExpenseAccount={id:crypto.randomUUID(),name:body.account.name.trim(),payee:body.account.payee.trim(),category:body.account.category.trim(),created_at:new Date().toISOString()};
    const next:Catalog={version:current.version+1,accounts:[...current.accounts,account]};
    const path=`${FOLDER}/${String(next.version).padStart(12,"0")}.json`;
    const {error}=await bucket.upload(path,JSON.stringify(next),{contentType:"application/json",cacheControl:"0",upsert:false});
    if(error){
      if(/duplicate|already exists/i.test(error.message) || String(error.statusCode)==="409")return json({error:"Another team member added an account. Refresh and retry."},409);
      throw new Error("Expense accounts could not be saved.");
    }
    return json(next,201);
  }catch(error){return failure(error);}
}
