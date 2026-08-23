import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QBO_AUTHORIZE_URL =
  "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_SCOPE =
  "com.intuit.quickbooks.accounting";

function env(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing server environment variable: ${name}`
    );
  }

  return value;
}

function publicSupabase() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

function adminSupabase() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function authenticatedHubUser(
  request: Request
) {
  const authorization =
    request.headers.get("authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();

  if (!token) return null;

  const supabase = publicSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

function qboEnvironment() {
  return (
    process.env.QBO_ENVIRONMENT?.trim().toLowerCase() ||
    "sandbox"
  );
}

function qboApiBase() {
  return qboEnvironment() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}


type QboConnection = {
  id: string;
  realm_id: string;
  company_name: string | null;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  connected_by: string | null;
  connected_at: string;
  last_refreshed_at: string | null;
  active: boolean;
  updated_at: string;
};

type HubClient = {
  id: string;
  client_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  active: boolean | null;
  qbo_customer_id: string | null;
  qbo_sync_token: string | null;
  qbo_synced_at: string | null;
};

type QboCustomer = {
  Id: string;
  SyncToken?: string;
  DisplayName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  Active?: boolean;
  PrimaryEmailAddr?: {
    Address?: string;
  };
  PrimaryPhone?: {
    FreeFormNumber?: string;
  };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
    Country?: string;
  };
};

class QboApiError extends Error {
  status: number;
  payload: unknown;

  constructor(
    message: string,
    status: number,
    payload: unknown
  ) {
    super(message);
    this.name = "QboApiError";
    this.status = status;
    this.payload = payload;
  }
}

function qboErrorMessage(
  payload: any,
  fallback: string
) {
  const first =
    payload?.Fault?.Error?.[0];

  return (
    first?.Detail ||
    first?.Message ||
    payload?.error_description ||
    payload?.error ||
    fallback
  );
}

async function loadActiveQboConnection() {
  const admin = adminSupabase();

  const { data, error } = await admin
    .from("qbo_connections")
    .select(
      "id,realm_id,company_name,access_token,refresh_token,access_token_expires_at,refresh_token_expires_at,connected_by,connected_at,last_refreshed_at,active,updated_at"
    )
    .eq("active", true)
    .order("updated_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load QuickBooks connection: ${error.message}`
    );
  }

  if (
    !data?.access_token ||
    !data?.refresh_token
  ) {
    throw new Error(
      "QuickBooks is not connected yet."
    );
  }

  return data as QboConnection;
}

function tokenNeedsRefresh(
  connection: QboConnection
) {
  if (!connection.access_token_expires_at) {
    return false;
  }

  const expiresAt = new Date(
    connection.access_token_expires_at
  ).getTime();

  return (
    Number.isFinite(expiresAt) &&
    expiresAt - Date.now() <
      5 * 60 * 1000
  );
}

async function refreshQboAccessToken(
  connection: QboConnection
) {
  const clientId = env("QBO_CLIENT_ID");
  const clientSecret =
    env("QBO_CLIENT_SECRET");

  const basic = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token:
      connection.refresh_token,
  });

  const response = await fetch(
    QBO_TOKEN_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new QboApiError(
      qboErrorMessage(
        payload,
        `QuickBooks token refresh failed (${response.status})`
      ),
      response.status,
      payload
    );
  }

  if (
    !payload?.access_token ||
    !payload?.refresh_token
  ) {
    throw new Error(
      "QuickBooks refresh response did not contain the expected tokens."
    );
  }

  const now =
    new Date().toISOString();

  const next: QboConnection = {
    ...connection,
    access_token:
      payload.access_token,
    refresh_token:
      payload.refresh_token,
    access_token_expires_at:
      expirationFromNow(
        payload.expires_in
      ),
    refresh_token_expires_at:
      expirationFromNow(
        payload.x_refresh_token_expires_in
      ) ||
      connection.refresh_token_expires_at,
    last_refreshed_at: now,
    updated_at: now,
  };

  const admin = adminSupabase();

  const { error } = await admin
    .from("qbo_connections")
    .update({
      access_token:
        next.access_token,
      refresh_token:
        next.refresh_token,
      access_token_expires_at:
        next.access_token_expires_at,
      refresh_token_expires_at:
        next.refresh_token_expires_at,
      last_refreshed_at: now,
      updated_at: now,
    })
    .eq("id", connection.id);

  if (error) {
    throw new Error(
      `QuickBooks refreshed its token, but the Hub could not save it: ${error.message}`
    );
  }

  return next;
}

async function qboJsonRequest(
  connection: QboConnection,
  path: string,
  init: RequestInit = {},
  retryAfterRefresh = true
): Promise<{
  data: any;
  connection: QboConnection;
}> {
  let current = connection;

  if (tokenNeedsRefresh(current)) {
    current =
      await refreshQboAccessToken(
        current
      );
  }

  const headers = new Headers(
    init.headers
  );

  headers.set(
    "Authorization",
    `Bearer ${current.access_token}`
  );
  headers.set(
    "Accept",
    "application/json"
  );

  if (init.body) {
    headers.set(
      "Content-Type",
      "application/json"
    );
  }

  let response = await fetch(
    `${qboApiBase()}${path}`,
    {
      ...init,
      headers,
      cache: "no-store",
    }
  );

  if (
    response.status === 401 &&
    retryAfterRefresh
  ) {
    current =
      await refreshQboAccessToken(
        current
      );

    headers.set(
      "Authorization",
      `Bearer ${current.access_token}`
    );

    response = await fetch(
      `${qboApiBase()}${path}`,
      {
        ...init,
        headers,
        cache: "no-store",
      }
    );
  }

  const raw = await response.text();

  let data: any = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {
        raw,
      };
    }
  }

  if (
    !response.ok ||
    data?.Fault
  ) {
    throw new QboApiError(
      qboErrorMessage(
        data,
        `QuickBooks API request failed (${response.status})`
      ),
      response.status,
      data
    );
  }

  return {
    data,
    connection: current,
  };
}

function qboCompanyPath(
  realmId: string,
  suffix: string
) {
  return (
    `/v3/company/${encodeURIComponent(
      realmId
    )}/${suffix}`
  );
}

function qboConnectUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env("QBO_CLIENT_ID"),
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: env("QBO_REDIRECT_URI"),
    state,
  });

  return `${QBO_AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeAuthorizationCode(
  code: string
) {
  const clientId = env("QBO_CLIENT_ID");
  const clientSecret = env("QBO_CLIENT_SECRET");

  const basic = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env("QBO_REDIRECT_URI"),
  });

  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type":
        "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload?.error_description ||
        payload?.error ||
        `QuickBooks token exchange failed (${response.status})`
    );
  }

  if (
    !payload?.access_token ||
    !payload?.refresh_token
  ) {
    throw new Error(
      "QuickBooks did not return the expected OAuth tokens."
    );
  }

  return payload as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    x_refresh_token_expires_in?: number;
    token_type?: string;
  };
}

async function loadCompanyName(
  realmId: string,
  accessToken: string
) {
  try {
    const endpoint =
      `${qboApiBase()}/v3/company/` +
      `${encodeURIComponent(realmId)}/companyinfo/` +
      `${encodeURIComponent(realmId)}`;

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const payload = await response.json();

    return (
      payload?.CompanyInfo?.CompanyName ||
      payload?.CompanyInfo?.LegalName ||
      null
    );
  } catch {
    return null;
  }
}

function expirationFromNow(
  seconds: unknown
) {
  const parsed = Number(seconds);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return new Date(
    Date.now() + parsed * 1000
  ).toISOString();
}


function hubClientDisplayName(
  client: HubClient
) {
  const direct =
    client.client_name?.trim();

  if (direct) return direct;

  const company =
    client.company_name?.trim();

  if (company) return company;

  const personal = [
    client.first_name,
    client.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return personal || "Hub Customer";
}

function buildQboCustomerPayload(
  client: HubClient
) {
  const payload: Record<
    string,
    unknown
  > = {
    DisplayName:
      hubClientDisplayName(client),
    Active:
      client.active !== false,
  };

  if (client.company_name?.trim()) {
    payload.CompanyName =
      client.company_name.trim();
  }

  if (client.first_name?.trim()) {
    payload.GivenName =
      client.first_name.trim();
  }

  if (client.last_name?.trim()) {
    payload.FamilyName =
      client.last_name.trim();
  }

  if (client.email?.trim()) {
    payload.PrimaryEmailAddr = {
      Address: client.email.trim(),
    };
  }

  if (client.phone?.trim()) {
    payload.PrimaryPhone = {
      FreeFormNumber:
        client.phone.trim(),
    };
  }

  const hasAddress = Boolean(
    client.street_address?.trim() ||
      client.city?.trim() ||
      client.state?.trim() ||
      client.zip_code?.trim()
  );

  if (hasAddress) {
    payload.BillAddr = {
      ...(client.street_address?.trim()
        ? {
            Line1:
              client.street_address.trim(),
          }
        : {}),
      ...(client.city?.trim()
        ? {
            City: client.city.trim(),
          }
        : {}),
      ...(client.state?.trim()
        ? {
            CountrySubDivisionCode:
              client.state.trim(),
          }
        : {}),
      ...(client.zip_code?.trim()
        ? {
            PostalCode:
              client.zip_code.trim(),
          }
        : {}),
      Country: "USA",
    };
  }

  return payload;
}

function normalizeText(
  value: unknown
) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeEmail(
  value: unknown
) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizePhone(
  value: unknown
) {
  const digits = String(value ?? "")
    .replace(/\D/g, "");

  if (digits.length > 10) {
    return digits.slice(-10);
  }

  return digits;
}

function candidateScore(
  client: HubClient,
  customer: QboCustomer
) {
  let score = 0;

  const clientName = normalizeText(
    hubClientDisplayName(client)
  );

  const qboName = normalizeText(
    customer.DisplayName
  );

  if (
    clientName &&
    qboName &&
    clientName === qboName
  ) {
    score += 4;
  }

  const clientCompany =
    normalizeText(
      client.company_name
    );

  const qboCompany =
    normalizeText(
      customer.CompanyName
    );

  if (
    clientCompany &&
    qboCompany &&
    clientCompany === qboCompany
  ) {
    score += 3;
  }

  const clientEmail =
    normalizeEmail(client.email);

  const qboEmail =
    normalizeEmail(
      customer.PrimaryEmailAddr?.Address
    );

  if (
    clientEmail &&
    qboEmail &&
    clientEmail === qboEmail
  ) {
    score += 6;
  }

  const clientPhone =
    normalizePhone(client.phone);

  const qboPhone =
    normalizePhone(
      customer.PrimaryPhone?.FreeFormNumber
    );

  if (
    clientPhone.length >= 7 &&
    qboPhone.length >= 7 &&
    clientPhone === qboPhone
  ) {
    score += 4;
  }

  const clientStreet =
    normalizeText(
      client.street_address
    );

  const qboStreet =
    normalizeText(
      customer.BillAddr?.Line1
    );

  const clientZip =
    normalizeText(client.zip_code);

  const qboZip =
    normalizeText(
      customer.BillAddr?.PostalCode
    );

  if (
    clientStreet &&
    qboStreet &&
    clientZip &&
    qboZip &&
    clientStreet === qboStreet &&
    clientZip === qboZip
  ) {
    score += 5;
  }

  return score;
}

function sanitizedCandidate(
  customer: QboCustomer,
  score: number
) {
  return {
    id: customer.Id,
    display_name:
      customer.DisplayName || "",
    company_name:
      customer.CompanyName || "",
    email:
      customer.PrimaryEmailAddr?.Address ||
      "",
    phone:
      customer.PrimaryPhone
        ?.FreeFormNumber || "",
    street:
      customer.BillAddr?.Line1 || "",
    city:
      customer.BillAddr?.City || "",
    state:
      customer.BillAddr
        ?.CountrySubDivisionCode || "",
    zip:
      customer.BillAddr?.PostalCode ||
      "",
    active:
      customer.Active !== false,
    match_score: score,
  };
}

async function loadAllQboCustomers(
  connection: QboConnection
) {
  const customers: QboCustomer[] = [];
  let current = connection;
  let startPosition = 1;
  const maxResults = 1000;

  for (let page = 0; page < 50; page += 1) {
    const query =
      `select * from Customer ` +
      `startposition ${startPosition} ` +
      `maxresults ${maxResults}`;

    const { data, connection: next } =
      await qboJsonRequest(
        current,
        qboCompanyPath(
          current.realm_id,
          `query?query=${encodeURIComponent(
            query
          )}`
        ),
        {
          method: "GET",
        }
      );

    current = next;

    const pageCustomers =
      (data?.QueryResponse?.Customer ||
        []) as QboCustomer[];

    customers.push(
      ...pageCustomers
    );

    if (
      pageCustomers.length <
      maxResults
    ) {
      break;
    }

    startPosition +=
      pageCustomers.length;
  }

  return {
    customers,
    connection: current,
  };
}

async function loadQboCustomerById(
  connection: QboConnection,
  customerId: string
) {
  const result =
    await qboJsonRequest(
      connection,
      qboCompanyPath(
        connection.realm_id,
        `customer/${encodeURIComponent(
          customerId
        )}`
      ),
      {
        method: "GET",
      }
    );

  const customer =
    result.data?.Customer as
      | QboCustomer
      | undefined;

  if (!customer?.Id) {
    throw new Error(
      "QuickBooks customer could not be loaded."
    );
  }

  return {
    customer,
    connection: result.connection,
  };
}

async function saveQboCustomer(
  connection: QboConnection,
  client: HubClient,
  existingCustomer?: QboCustomer | null
) {
  const customerPayload =
    buildQboCustomerPayload(client);

  let requestPayload:
    Record<string, unknown>;

  let operation:
    | "Create"
    | "Update";

  if (existingCustomer?.Id) {
    requestPayload = {
      ...customerPayload,
      Id: existingCustomer.Id,
      SyncToken:
        existingCustomer.SyncToken ||
        "0",
      sparse: true,
    };

    operation = "Update";
  } else {
    requestPayload =
      customerPayload;

    operation = "Create";
  }

  const result =
    await qboJsonRequest(
      connection,
      qboCompanyPath(
        connection.realm_id,
        "customer"
      ),
      {
        method: "POST",
        body: JSON.stringify(
          requestPayload
        ),
      }
    );

  const customer =
    result.data?.Customer as
      | QboCustomer
      | undefined;

  if (!customer?.Id) {
    throw new Error(
      "QuickBooks did not return the saved customer."
    );
  }

  return {
    customer,
    connection: result.connection,
    operation,
    requestPayload,
  };
}

async function logQboSync(input: {
  entityType: string;
  entityId: string | null;
  operation: string;
  status: string;
  qboEntityId?: string | null;
  errorMessage?: string | null;
  requestPayload?: unknown;
  responsePayload?: unknown;
  createdBy?: string | null;
}) {
  try {
    const admin = adminSupabase();

    await admin.from("qbo_sync_log").insert({
      entity_type:
        input.entityType,
      entity_id:
        input.entityId,
      direction:
        "Hub to QuickBooks",
      operation:
        input.operation,
      status:
        input.status,
      qbo_entity_id:
        input.qboEntityId || null,
      error_message:
        input.errorMessage || null,
      request_payload:
        input.requestPayload || null,
      response_payload:
        input.responsePayload || null,
      attempted_at:
        new Date().toISOString(),
      completed_at:
        input.status === "Pending"
          ? null
          : new Date().toISOString(),
      created_by:
        input.createdBy || null,
    });
  } catch {
    // Sync logging should not hide the primary result.
  }
}

async function logConnectionEvent(input: {
  status: "Success" | "Failed";
  qboEntityId?: string | null;
  errorMessage?: string | null;
  createdBy?: string | null;
}) {
  try {
    const admin = adminSupabase();

    await admin.from("qbo_sync_log").insert({
      entity_type: "qbo_connection",
      entity_id: null,
      direction: "Hub to QuickBooks",
      operation: "Connect",
      status: input.status,
      qbo_entity_id:
        input.qboEntityId || null,
      error_message:
        input.errorMessage || null,
      request_payload: null,
      response_payload: null,
      attempted_at:
        new Date().toISOString(),
      completed_at:
        new Date().toISOString(),
      created_by:
        input.createdBy || null,
    });
  } catch {
    // Connection logging must never break OAuth.
  }
}

function clearOauthCookies(
  response: NextResponse
) {
  response.cookies.set(
    "qbo_oauth_state",
    "",
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV ===
        "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }
  );

  response.cookies.set(
    "qbo_oauth_user",
    "",
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV ===
        "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }
  );
}

function hubRedirect(
  request: Request,
  params: Record<string, string>
) {
  const url = new URL("/", request.url);

  Object.entries(params).forEach(
    ([key, value]) => {
      url.searchParams.set(key, value);
    }
  );

  return NextResponse.redirect(url);
}

/**
 * GET /api/quickbooks
 *
 * Intuit redirects here after OAuth authorization.
 * This endpoint validates the state cookie, exchanges
 * the one-time code, and stores the resulting connection
 * in the server-only qbo_connections table.
 */
export async function GET(
  request: Request
) {
  const url = new URL(request.url);

  const code =
    url.searchParams.get("code");
  const realmId =
    url.searchParams.get("realmId");
  const returnedState =
    url.searchParams.get("state");
  const oauthError =
    url.searchParams.get("error");

  const cookieHeader =
    request.headers.get("cookie") || "";

  const cookieMap = new Map(
    cookieHeader
      .split(";")
      .map((entry) =>
        entry.trim().split("=")
      )
      .filter(
        (parts) => parts.length >= 2
      )
      .map(([key, ...rest]) => [
        key,
        decodeURIComponent(
          rest.join("=")
        ),
      ])
  );

  const expectedState =
    cookieMap.get("qbo_oauth_state") ||
    "";
  const connectedBy =
    cookieMap.get("qbo_oauth_user") ||
    null;

  if (oauthError) {
    await logConnectionEvent({
      status: "Failed",
      errorMessage: oauthError,
      createdBy: connectedBy,
    });

    const response = hubRedirect(
      request,
      {
        quickbooks: "error",
        reason: "authorization_declined",
      }
    );

    clearOauthCookies(response);
    return response;
  }

  if (
    !code ||
    !realmId ||
    !returnedState ||
    !expectedState ||
    returnedState !== expectedState
  ) {
    await logConnectionEvent({
      status: "Failed",
      errorMessage:
        "OAuth callback state validation failed.",
      createdBy: connectedBy,
    });

    const response = hubRedirect(
      request,
      {
        quickbooks: "error",
        reason: "invalid_state",
      }
    );

    clearOauthCookies(response);
    return response;
  }

  try {
    const tokens =
      await exchangeAuthorizationCode(
        code
      );

    const companyName =
      await loadCompanyName(
        realmId,
        tokens.access_token
      );

    const now =
      new Date().toISOString();

    const admin =
      adminSupabase();

    const { error } = await admin
      .from("qbo_connections")
      .upsert(
        {
          realm_id: realmId,
          company_name:
            companyName,
          access_token:
            tokens.access_token,
          refresh_token:
            tokens.refresh_token,
          access_token_expires_at:
            expirationFromNow(
              tokens.expires_in
            ),
          refresh_token_expires_at:
            expirationFromNow(
              tokens.x_refresh_token_expires_in
            ),
          connected_by:
            connectedBy,
          connected_at: now,
          last_refreshed_at: now,
          active: true,
          updated_at: now,
        },
        {
          onConflict: "realm_id",
        }
      );

    if (error) {
      throw new Error(
        `Could not save QuickBooks connection: ${error.message}`
      );
    }

    await logConnectionEvent({
      status: "Success",
      qboEntityId: realmId,
      createdBy: connectedBy,
    });

    const response = hubRedirect(
      request,
      {
        quickbooks: "connected",
      }
    );

    clearOauthCookies(response);
    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown QuickBooks connection error";

    await logConnectionEvent({
      status: "Failed",
      qboEntityId: realmId,
      errorMessage: message,
      createdBy: connectedBy,
    });

    const response = hubRedirect(
      request,
      {
        quickbooks: "error",
        reason: "token_exchange",
      }
    );

    clearOauthCookies(response);
    return response;
  }
}

/**
 * POST /api/quickbooks
 *
 * action=connect
 *   Verifies the current Hub user and returns the
 *   Intuit authorization URL.
 *
 * action=status
 *   Returns sanitized connection status. OAuth tokens
 *   are never returned to the browser.
 *
 * action=sync_customer
 *   Creates or updates one Hub client in QuickBooks.
 *   Existing Hub mappings are honored. Before creating
 *   a new QBO Customer, the server scans existing QBO
 *   customers and either auto-matches a strong unique
 *   match or returns review candidates.
 */
export async function POST(
  request: Request
) {
  try {
    const user =
      await authenticatedHubUser(request);

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Hub authentication is required.",
        },
        {
          status: 401,
        }
      );
    }

    const body = await request
      .json()
      .catch(() => ({}));

    const action =
      String(body?.action || "");

    if (action === "connect") {
      const state =
        randomBytes(32).toString(
          "hex"
        );

      const response =
        NextResponse.json({
          url: qboConnectUrl(state),
        });

      const cookieOptions = {
        httpOnly: true,
        secure:
          process.env.NODE_ENV ===
          "production",
        sameSite:
          "lax" as const,
        path: "/",
        maxAge: 10 * 60,
      };

      response.cookies.set(
        "qbo_oauth_state",
        state,
        cookieOptions
      );

      response.cookies.set(
        "qbo_oauth_user",
        user.id,
        cookieOptions
      );

      return response;
    }

    if (action === "status") {
      const admin =
        adminSupabase();

      const { data, error } =
        await admin
          .from("qbo_connections")
          .select(
            "id,realm_id,company_name,access_token_expires_at,refresh_token_expires_at,connected_at,last_refreshed_at,active,updated_at"
          )
          .eq("active", true)
          .order("updated_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle();

      if (error) {
        return NextResponse.json(
          {
            error:
              error.message,
          },
          {
            status: 500,
          }
        );
      }

      return NextResponse.json({
        connected: Boolean(data),
        connection: data || null,
        environment:
          qboEnvironment(),
      });
    }

    if (action === "sync_customer") {
      const clientId =
        String(
          body?.client_id || ""
        ).trim();

      const requestedMatchId =
        String(
          body?.match_qbo_customer_id ||
            ""
        ).trim();

      const forceCreate =
        body?.force_create === true;

      if (!clientId) {
        return NextResponse.json(
          {
            error:
              "client_id is required.",
          },
          {
            status: 400,
          }
        );
      }

      const admin =
        adminSupabase();

      const { data: clientData, error: clientError } =
        await admin
          .from("clients")
          .select(
            "id,client_name,first_name,last_name,company_name,email,phone,street_address,city,state,zip_code,active,qbo_customer_id,qbo_sync_token,qbo_synced_at"
          )
          .eq("id", clientId)
          .single();

      if (clientError || !clientData) {
        return NextResponse.json(
          {
            error:
              clientError?.message ||
              "Hub client not found.",
          },
          {
            status: 404,
          }
        );
      }

      const client =
        clientData as HubClient;

      let connection:
        QboConnection;

      try {
        connection =
          await loadActiveQboConnection();
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "QuickBooks is not connected.",
          },
          {
            status: 409,
          }
        );
      }

      let existingCustomer:
        QboCustomer | null = null;

      let operationContext =
        client.qbo_customer_id
          ? "Update Customer"
          : "Create Customer";

      try {
        if (client.qbo_customer_id) {
          const loaded =
            await loadQboCustomerById(
              connection,
              client.qbo_customer_id
            );

          existingCustomer =
            loaded.customer;
          connection =
            loaded.connection;
        } else if (requestedMatchId) {
          const loaded =
            await loadQboCustomerById(
              connection,
              requestedMatchId
            );

          existingCustomer =
            loaded.customer;
          connection =
            loaded.connection;
          operationContext =
            "Link & Update Customer";
        } else if (!forceCreate) {
          const loaded =
            await loadAllQboCustomers(
              connection
            );

          connection =
            loaded.connection;

          const scored =
            loaded.customers
              .map((customer) => ({
                customer,
                score:
                  candidateScore(
                    client,
                    customer
                  ),
              }))
              .filter(
                (entry) =>
                  entry.score > 0
              )
              .sort(
                (a, b) =>
                  b.score - a.score
              );

          const strongest =
            scored.filter(
              (entry) =>
                entry.score >= 6
            );

          if (
            strongest.length === 1 &&
            (scored.length === 1 ||
              strongest[0].score >
                scored[1].score)
          ) {
            existingCustomer =
              strongest[0].customer;
            operationContext =
              "Auto-Link & Update Customer";
          } else {
            const nameMatches =
              scored.filter(
                (entry) =>
                  entry.score >= 4
              );

            if (
              strongest.length > 1 ||
              nameMatches.length > 0
            ) {
              const candidates =
                scored
                  .slice(0, 5)
                  .map((entry) =>
                    sanitizedCandidate(
                      entry.customer,
                      entry.score
                    )
                  );

              await logQboSync({
                entityType: "client",
                entityId: client.id,
                operation:
                  "Match Customer",
                status:
                  "Needs Review",
                requestPayload: {
                  client_name:
                    hubClientDisplayName(
                      client
                    ),
                },
                responsePayload: {
                  candidates,
                },
                createdBy: user.id,
              });

              return NextResponse.json(
                {
                  status:
                    "match_required",
                  client_id:
                    client.id,
                  client_name:
                    hubClientDisplayName(
                      client
                    ),
                  candidates,
                },
                {
                  status: 409,
                }
              );
            }
          }
        }

        if (existingCustomer?.Id) {
          const loaded =
            await loadQboCustomerById(
              connection,
              existingCustomer.Id
            );

          existingCustomer =
            loaded.customer;
          connection =
            loaded.connection;
        }

        const saved =
          await saveQboCustomer(
            connection,
            client,
            existingCustomer
          );

        connection =
          saved.connection;

        const now =
          new Date().toISOString();

        const { error: updateError } =
          await admin
            .from("clients")
            .update({
              qbo_customer_id:
                saved.customer.Id,
              qbo_sync_token:
                saved.customer.SyncToken ||
                null,
              qbo_synced_at: now,
            })
            .eq("id", client.id);

        if (updateError) {
          throw new Error(
            `QuickBooks saved the customer, but the Hub could not save the QuickBooks mapping: ${updateError.message}`
          );
        }

        await logQboSync({
          entityType: "client",
          entityId: client.id,
          operation:
            operationContext,
          status: "Success",
          qboEntityId:
            saved.customer.Id,
          requestPayload:
            saved.requestPayload,
          responsePayload: {
            Id:
              saved.customer.Id,
            SyncToken:
              saved.customer.SyncToken ||
              null,
            DisplayName:
              saved.customer.DisplayName ||
              hubClientDisplayName(
                client
              ),
          },
          createdBy: user.id,
        });

        return NextResponse.json({
          status: "success",
          operation:
            operationContext,
          client_id:
            client.id,
          qbo_customer_id:
            saved.customer.Id,
          qbo_sync_token:
            saved.customer.SyncToken ||
            null,
          qbo_display_name:
            saved.customer.DisplayName ||
            hubClientDisplayName(
              client
            ),
          qbo_company:
            connection.company_name,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown customer sync error";

        await logQboSync({
          entityType: "client",
          entityId: client.id,
          operation:
            operationContext,
          status: "Failed",
          qboEntityId:
            client.qbo_customer_id ||
            requestedMatchId ||
            null,
          errorMessage: message,
          createdBy: user.id,
        });

        return NextResponse.json(
          {
            error: message,
          },
          {
            status:
              error instanceof QboApiError
                ? error.status || 502
                : 500,
          }
        );
      }
    }

    return NextResponse.json(
      {
        error:
          "Unknown QuickBooks action.",
      },
      {
        status: 400,
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "QuickBooks server error",
      },
      {
        status: 500,
      }
    );
  }
}
