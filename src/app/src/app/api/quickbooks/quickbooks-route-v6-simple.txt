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


type HubManufacturer = {
  id: string;
  name: string;
  account_number: string | null;
  orders_email: string | null;
  phone: string | null;
  active: boolean | null;
  qbo_vendor_id: string | null;
  qbo_sync_token: string | null;
  qbo_synced_at: string | null;
};

type QboVendor = {
  Id: string;
  SyncToken?: string;
  DisplayName?: string;
  CompanyName?: string;
  PrintOnCheckName?: string;
  AcctNum?: string;
  Active?: boolean;
  PrimaryEmailAddr?: {
    Address?: string;
  };
  PrimaryPhone?: {
    FreeFormNumber?: string;
  };
};


type HubSalesOrder = {
  id: string;
  sale_number: number;
  client_id: string;
  status: string | null;
  order_date: string;
  customer_po: string | null;
  notes: string | null;
  ship_to_address: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  delivery_notes: string | null;
  freight_amount: number | string | null;
  adjustment_amount: number | string | null;
  tax_amount: number | string | null;
  qbo_invoice_id: string | null;
  qbo_sync_token: string | null;
  qbo_synced_at: string | null;
};

type HubSalesOrderItem = {
  id: string;
  manufacturer_id: string | null;
  sort_order: number | null;
  quantity: number | string | null;
  sku: string | null;
  description: string | null;
  finish: string | null;
  fabric_name: string | null;
  grade: string | null;
  additional_details: string | null;
  unit_price: number | string | null;
};

type QboMapping = {
  id: string;
  connection_id: string;
  mapping_type: string;
  local_key: string;
  qbo_entity_type: string;
  qbo_entity_id: string;
  qbo_entity_name: string | null;
  metadata: Record<string, unknown> | null;
};

type QboInvoice = {
  Id: string;
  SyncToken?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
};


type HubCustomerPayment = {
  id: string;
  sales_order_id: string;
  payment_date: string;
  amount: number | string;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  posted: boolean;
  reversal_of_payment_id: string | null;
  correction_of_payment_id: string | null;
  qbo_payment_id: string | null;
  qbo_sync_token: string | null;
  qbo_synced_at: string | null;
};

type QboPayment = {
  Id: string;
  SyncToken?: string;
  TxnDate?: string;
  TotalAmt?: number;
  UnappliedAmt?: number;
  PaymentRefNum?: string;
};


type QboSetupItem = {
  Id: string;
  Name?: string;
  FullyQualifiedName?: string;
  Type?: string;
  Active?: boolean;
};

type QboSetupTaxCode = {
  Id: string;
  Name?: string;
  Description?: string;
  Active?: boolean;
  Taxable?: boolean;
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

function moneyNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? Math.round(parsed * 100) / 100
    : 0;
}

function cleanQboText(
  value: unknown,
  maxLength: number
) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

async function loadQboMapping(
  connectionId: string,
  mappingType: string,
  localKey: string
) {
  const admin = adminSupabase();

  const { data, error } = await admin
    .from("qbo_mappings")
    .select(
      "id,connection_id,mapping_type,local_key,qbo_entity_type,qbo_entity_id,qbo_entity_name,metadata"
    )
    .eq("connection_id", connectionId)
    .eq("mapping_type", mappingType)
    .eq("local_key", localKey)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load QuickBooks mapping ${mappingType}/${localKey}: ${error.message}`
    );
  }

  return (data || null) as
    | QboMapping
    | null;
}

async function loadQboSetupOptions(
  connection: QboConnection
) {
  let current = connection;

  const itemQuery =
    "select * from Item maxresults 1000";

  const itemResult =
    await qboJsonRequest(
      current,
      qboCompanyPath(
        current.realm_id,
        `query?query=${encodeURIComponent(
          itemQuery
        )}`
      ),
      {
        method: "GET",
      }
    );

  current = itemResult.connection;

  const taxQuery =
    "select * from TaxCode maxresults 1000";

  const taxResult =
    await qboJsonRequest(
      current,
      qboCompanyPath(
        current.realm_id,
        `query?query=${encodeURIComponent(
          taxQuery
        )}`
      ),
      {
        method: "GET",
      }
    );

  current = taxResult.connection;

  const items =
    (
      itemResult.data?.QueryResponse
        ?.Item || []
    ) as QboSetupItem[];

  const taxCodes =
    (
      taxResult.data?.QueryResponse
        ?.TaxCode || []
    ) as QboSetupTaxCode[];

  return {
    connection: current,
    items: items
      .filter(
        (item) =>
          item?.Id &&
          item.Active !== false
      )
      .map((item) => ({
        id: item.Id,
        name:
          item.FullyQualifiedName ||
          item.Name ||
          `Item ${item.Id}`,
        type: item.Type || "",
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    tax_codes: taxCodes
      .filter(
        (taxCode) =>
          taxCode?.Id &&
          taxCode.Active !== false
      )
      .map((taxCode) => ({
        id: taxCode.Id,
        name:
          taxCode.Name ||
          `Tax Code ${taxCode.Id}`,
        description:
          taxCode.Description || "",
        taxable:
          taxCode.Taxable ?? null,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
  };
}

const allowedQboMappings = new Map<
  string,
  {
    entityType: string;
    purpose: string;
  }
>([
  [
    "sales_item:merchandise",
    {
      entityType: "Item",
      purpose: "Merchandise",
    },
  ],
  [
    "sales_item:freight",
    {
      entityType: "Item",
      purpose: "Freight",
    },
  ],
  [
    "sales_item:adjustment",
    {
      entityType: "Item",
      purpose: "Sales Adjustment",
    },
  ],
  [
    "tax_code:sales_tax",
    {
      entityType: "TaxCode",
      purpose: "Sales Tax",
    },
  ],
]);

function buildQboVendorPayload(
  manufacturer: HubManufacturer
) {
  const name = manufacturer.name.trim();

  const payload: Record<
    string,
    unknown
  > = {
    DisplayName: name,
    CompanyName: name,
    PrintOnCheckName: name,
    Active:
      manufacturer.active !== false,
  };

  if (manufacturer.orders_email?.trim()) {
    payload.PrimaryEmailAddr = {
      Address:
        manufacturer.orders_email.trim(),
    };
  }

  if (manufacturer.phone?.trim()) {
    payload.PrimaryPhone = {
      FreeFormNumber:
        manufacturer.phone.trim(),
    };
  }

  if (manufacturer.account_number?.trim()) {
    payload.AcctNum =
      manufacturer.account_number
        .trim()
        .slice(0, 15);
  }

  return payload;
}

function vendorCandidateScore(
  manufacturer: HubManufacturer,
  vendor: QboVendor
) {
  let score = 0;

  const manufacturerName =
    normalizeText(manufacturer.name);

  const vendorName =
    normalizeText(
      vendor.DisplayName ||
        vendor.CompanyName ||
        vendor.PrintOnCheckName
    );

  if (
    manufacturerName &&
    vendorName &&
    manufacturerName === vendorName
  ) {
    score += 6;
  }

  const email =
    normalizeEmail(
      manufacturer.orders_email
    );

  const vendorEmail =
    normalizeEmail(
      vendor.PrimaryEmailAddr?.Address
    );

  if (
    email &&
    vendorEmail &&
    email === vendorEmail
  ) {
    score += 6;
  }

  const phone =
    normalizePhone(manufacturer.phone);

  const vendorPhone =
    normalizePhone(
      vendor.PrimaryPhone?.FreeFormNumber
    );

  if (
    phone.length >= 7 &&
    vendorPhone.length >= 7 &&
    phone === vendorPhone
  ) {
    score += 4;
  }

  const accountNumber =
    normalizeText(
      manufacturer.account_number
    );

  const vendorAccountNumber =
    normalizeText(vendor.AcctNum);

  if (
    accountNumber &&
    vendorAccountNumber &&
    accountNumber ===
      vendorAccountNumber
  ) {
    score += 5;
  }

  return score;
}

function sanitizedVendorCandidate(
  vendor: QboVendor,
  score: number
) {
  return {
    id: vendor.Id,
    display_name:
      vendor.DisplayName || "",
    company_name:
      vendor.CompanyName || "",
    email:
      vendor.PrimaryEmailAddr?.Address ||
      "",
    phone:
      vendor.PrimaryPhone
        ?.FreeFormNumber || "",
    account_number:
      vendor.AcctNum || "",
    active:
      vendor.Active !== false,
    match_score: score,
  };
}

async function loadAllQboVendors(
  connection: QboConnection
) {
  const vendors: QboVendor[] = [];
  let current = connection;
  let startPosition = 1;
  const maxResults = 1000;

  for (let page = 0; page < 50; page += 1) {
    const query =
      `select * from Vendor ` +
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

    const pageVendors =
      (data?.QueryResponse?.Vendor ||
        []) as QboVendor[];

    vendors.push(...pageVendors);

    if (
      pageVendors.length <
      maxResults
    ) {
      break;
    }

    startPosition +=
      pageVendors.length;
  }

  return {
    vendors,
    connection: current,
  };
}

async function loadQboVendorById(
  connection: QboConnection,
  vendorId: string
) {
  const result =
    await qboJsonRequest(
      connection,
      qboCompanyPath(
        connection.realm_id,
        `vendor/${encodeURIComponent(
          vendorId
        )}`
      ),
      {
        method: "GET",
      }
    );

  const vendor =
    result.data?.Vendor as
      | QboVendor
      | undefined;

  if (!vendor?.Id) {
    throw new Error(
      "QuickBooks vendor could not be loaded."
    );
  }

  return {
    vendor,
    connection: result.connection,
  };
}

async function saveQboVendor(
  connection: QboConnection,
  manufacturer: HubManufacturer,
  existingVendor?: QboVendor | null
) {
  const vendorPayload =
    buildQboVendorPayload(
      manufacturer
    );

  let requestPayload:
    Record<string, unknown>;

  let operation:
    | "Create"
    | "Update";

  if (existingVendor?.Id) {
    requestPayload = {
      ...vendorPayload,
      Id: existingVendor.Id,
      SyncToken:
        existingVendor.SyncToken ||
        "0",
      sparse: true,
    };

    operation = "Update";
  } else {
    requestPayload =
      vendorPayload;

    operation = "Create";
  }

  const result =
    await qboJsonRequest(
      connection,
      qboCompanyPath(
        connection.realm_id,
        "vendor"
      ),
      {
        method: "POST",
        body: JSON.stringify(
          requestPayload
        ),
      }
    );

  const vendor =
    result.data?.Vendor as
      | QboVendor
      | undefined;

  if (!vendor?.Id) {
    throw new Error(
      "QuickBooks did not return the saved vendor."
    );
  }

  return {
    vendor,
    connection: result.connection,
    operation,
    requestPayload,
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

function buildInvoiceDescription(
  item: HubSalesOrderItem
) {
  return cleanQboText(
    [
      item.sku ? `SKU ${item.sku}` : "",
      item.description || "",
      item.finish
        ? `Finish: ${item.finish}`
        : "",
      item.fabric_name
        ? `Fabric: ${item.fabric_name}`
        : "",
      item.grade
        ? `Grade: ${item.grade}`
        : "",
      item.additional_details || "",
    ]
      .filter(Boolean)
      .join(" | "),
    4000
  );
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
 *
 * action=sync_vendor
 *   Creates or updates one Hub manufacturer as a QBO
 *   Vendor. Existing Hub mappings are honored. Before
 *   creating a new Vendor, the server scans existing QBO
 *   vendors and either auto-matches a strong unique match
 *   or returns review candidates.
 *
 * action=sync_invoice
 *   Pushes one Hub Sales Order to QuickBooks as a new
 *   Invoice. This is intentionally one-way and create-once:
 *   after a QuickBooks Invoice ID is stored, the Hub will
 *   not silently rewrite that invoice.
 *
 * action=mapping_setup
 *   Reads the small set of QuickBooks Products/Services
 *   and Tax Codes needed to configure Hub-to-QBO pushes,
 *   plus the mappings already saved for this company.
 *
 * action=save_mapping
 *   Saves or clears one approved accounting mapping.
 *   These mappings are configuration only; they do not
 *   turn on QuickBooks-to-Hub syncing.
 *
 * action=sync_payment
 *   Pushes one posted positive Hub customer payment to
 *   QuickBooks and applies it to the already-pushed QBO
 *   Invoice. It is intentionally create-once and one-way.
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

    if (action === "mapping_setup") {
      let connection:
        QboConnection;

      try {
        connection =
          await loadActiveQboConnection();
      } catch (error) {
        return NextResponse.json(
          {
            connected: false,
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

      try {
        const setup =
          await loadQboSetupOptions(
            connection
          );

        connection =
          setup.connection;

        const admin =
          adminSupabase();

        const {
          data: mappingData,
          error: mappingError,
        } = await admin
          .from("qbo_mappings")
          .select(
            "id,connection_id,mapping_type,local_key,qbo_entity_type,qbo_entity_id,qbo_entity_name,metadata,updated_at"
          )
          .eq(
            "connection_id",
            connection.id
          )
          .in("mapping_type", [
            "sales_item",
            "tax_code",
          ])
          .order("mapping_type", {
            ascending: true,
          })
          .order("local_key", {
            ascending: true,
          });

        if (mappingError) {
          throw new Error(
            `Could not load QuickBooks mappings: ${mappingError.message}`
          );
        }

        return NextResponse.json({
          connected: true,
          environment:
            qboEnvironment(),
          company: {
            name:
              connection.company_name,
            realm_id:
              connection.realm_id,
          },
          items: setup.items,
          tax_codes:
            setup.tax_codes,
          mappings:
            mappingData || [],
        });
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "QuickBooks setup options could not be loaded.",
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

    if (action === "save_mapping") {
      const mappingType =
        String(
          body?.mapping_type || ""
        ).trim();

      const localKey =
        String(
          body?.local_key || ""
        ).trim();

      const qboEntityId =
        String(
          body?.qbo_entity_id || ""
        ).trim();

      const qboEntityName =
        String(
          body?.qbo_entity_name || ""
        ).trim();

      const mappingKey =
        `${mappingType}:${localKey}`;

      const allowed =
        allowedQboMappings.get(
          mappingKey
        );

      if (!allowed) {
        return NextResponse.json(
          {
            error:
              "That QuickBooks mapping is not supported.",
          },
          {
            status: 400,
          }
        );
      }

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

      const admin =
        adminSupabase();

      if (!qboEntityId) {
        const { error } = await admin
          .from("qbo_mappings")
          .delete()
          .eq(
            "connection_id",
            connection.id
          )
          .eq(
            "mapping_type",
            mappingType
          )
          .eq(
            "local_key",
            localKey
          );

        if (error) {
          return NextResponse.json(
            {
              error:
                `Could not clear QuickBooks mapping: ${error.message}`,
            },
            {
              status: 500,
            }
          );
        }

        return NextResponse.json({
          status: "success",
          cleared: true,
          mapping_type:
            mappingType,
          local_key: localKey,
        });
      }

      const { error } = await admin
        .from("qbo_mappings")
        .upsert(
          {
            connection_id:
              connection.id,
            mapping_type:
              mappingType,
            local_key:
              localKey,
            qbo_entity_type:
              allowed.entityType,
            qbo_entity_id:
              qboEntityId,
            qbo_entity_name:
              qboEntityName || null,
            metadata: {
              purpose:
                allowed.purpose,
              configured_by:
                user.id,
            },
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              "connection_id,mapping_type,local_key",
          }
        );

      if (error) {
        return NextResponse.json(
          {
            error:
              `Could not save QuickBooks mapping: ${error.message}`,
          },
          {
            status: 500,
          }
        );
      }

      await logQboSync({
        entityType:
          "qbo_mapping",
        entityId: null,
        operation:
          "Configure Mapping",
        status: "Success",
        qboEntityId:
          qboEntityId,
        requestPayload: {
          mapping_type:
            mappingType,
          local_key:
            localKey,
          qbo_entity_name:
            qboEntityName || null,
        },
        createdBy: user.id,
      });

      return NextResponse.json({
        status: "success",
        mapping: {
          mapping_type:
            mappingType,
          local_key:
            localKey,
          qbo_entity_type:
            allowed.entityType,
          qbo_entity_id:
            qboEntityId,
          qbo_entity_name:
            qboEntityName || null,
        },
      });
    }

    if (action === "sync_payment") {
      const paymentId =
        String(
          body?.payment_id || ""
        ).trim();

      if (!paymentId) {
        return NextResponse.json(
          {
            error:
              "payment_id is required.",
          },
          {
            status: 400,
          }
        );
      }

      const admin =
        adminSupabase();

      const {
        data: paymentData,
        error: paymentError,
      } = await admin
        .from("payments")
        .select(
          "id,sales_order_id,payment_date,amount,payment_method,reference,notes,posted,reversal_of_payment_id,correction_of_payment_id,qbo_payment_id,qbo_sync_token,qbo_synced_at"
        )
        .eq("id", paymentId)
        .single();

      if (
        paymentError ||
        !paymentData
      ) {
        return NextResponse.json(
          {
            error:
              paymentError?.message ||
              "Customer payment not found.",
          },
          {
            status: 404,
          }
        );
      }

      const payment =
        paymentData as HubCustomerPayment;

      if (payment.qbo_payment_id) {
        return NextResponse.json(
          {
            status: "already_synced",
            error:
              "This payment has already been pushed to QuickBooks.",
            qbo_payment_id:
              payment.qbo_payment_id,
          },
          {
            status: 409,
          }
        );
      }

      if (!payment.posted) {
        return NextResponse.json(
          {
            status:
              "prerequisite_required",
            prerequisite:
              "posted_payment",
            error:
              "Only posted customer payments can be pushed to QuickBooks.",
          },
          {
            status: 409,
          }
        );
      }

      const paymentAmount =
        moneyNumber(payment.amount);

      if (
        paymentAmount <= 0 ||
        payment.reversal_of_payment_id
      ) {
        return NextResponse.json(
          {
            status: "not_eligible",
            error:
              "Reversal and non-positive payment entries are not pushed to QuickBooks as customer payments.",
          },
          {
            status: 409,
          }
        );
      }

      if (!payment.correction_of_payment_id) {
        const {
          data: correctionRows,
          error: correctionError,
        } = await admin
          .from("payments")
          .select("id")
          .eq(
            "correction_of_payment_id",
            payment.id
          )
          .limit(1);

        if (correctionError) {
          return NextResponse.json(
            {
              error:
                correctionError.message,
            },
            {
              status: 500,
            }
          );
        }

        if (
          correctionRows &&
          correctionRows.length > 0
        ) {
          return NextResponse.json(
            {
              status: "not_eligible",
              error:
                "This original payment was corrected in the Hub. Push the corrected replacement payment instead.",
            },
            {
              status: 409,
            }
          );
        }
      }

      const {
        data: saleData,
        error: saleError,
      } = await admin
        .from("sales_orders")
        .select(
          "id,sale_number,client_id,qbo_invoice_id"
        )
        .eq(
          "id",
          payment.sales_order_id
        )
        .single();

      if (
        saleError ||
        !saleData
      ) {
        return NextResponse.json(
          {
            error:
              saleError?.message ||
              "The linked Sales Order could not be loaded.",
          },
          {
            status: 409,
          }
        );
      }

      if (!saleData.qbo_invoice_id) {
        return NextResponse.json(
          {
            status:
              "prerequisite_required",
            prerequisite:
              "invoice_sync",
            error:
              "Push the Sales Order to QuickBooks before pushing its customer payments.",
            sales_order_id:
              saleData.id,
          },
          {
            status: 409,
          }
        );
      }

      const {
        data: clientData,
        error: clientError,
      } = await admin
        .from("clients")
        .select(
          "id,qbo_customer_id"
        )
        .eq(
          "id",
          saleData.client_id
        )
        .single();

      if (
        clientError ||
        !clientData
      ) {
        return NextResponse.json(
          {
            error:
              clientError?.message ||
              "The linked client could not be loaded.",
          },
          {
            status: 409,
          }
        );
      }

      if (
        !clientData.qbo_customer_id
      ) {
        return NextResponse.json(
          {
            status:
              "prerequisite_required",
            prerequisite:
              "customer_sync",
            error:
              "The client must be linked to QuickBooks before this payment can be pushed.",
          },
          {
            status: 409,
          }
        );
      }

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

      try {
        const payload:
          Record<string, unknown> = {
            CustomerRef: {
              value:
                clientData.qbo_customer_id,
            },
            TxnDate:
              payment.payment_date,
            TotalAmt:
              paymentAmount,
            Line: [
              {
                Amount:
                  paymentAmount,
                LinkedTxn: [
                  {
                    TxnId:
                      saleData.qbo_invoice_id,
                    TxnType:
                      "Invoice",
                  },
                ],
              },
            ],
            PrivateNote:
              cleanQboText(
                [
                  `Designer’s Patio Hub payment for Sales Order ${saleData.sale_number}`,
                  payment.payment_method
                    ? `Method: ${payment.payment_method}`
                    : "",
                  payment.notes || "",
                ]
                  .filter(Boolean)
                  .join(" | "),
                4000
              ),
            ...(payment.reference?.trim()
              ? {
                  PaymentRefNum:
                    cleanQboText(
                      payment.reference,
                      21
                    ),
                }
              : {}),
          };

        const result =
          await qboJsonRequest(
            connection,
            qboCompanyPath(
              connection.realm_id,
              "payment"
            ),
            {
              method: "POST",
              body: JSON.stringify(
                payload
              ),
            }
          );

        connection =
          result.connection;

        const qboPayment =
          result.data?.Payment as
            | QboPayment
            | undefined;

        if (!qboPayment?.Id) {
          throw new Error(
            "QuickBooks did not return the created payment."
          );
        }

        const now =
          new Date().toISOString();

        const {
          error: updateError,
        } = await admin
          .from("payments")
          .update({
            qbo_payment_id:
              qboPayment.Id,
            qbo_sync_token:
              qboPayment.SyncToken ||
              null,
            qbo_synced_at: now,
          })
          .eq("id", payment.id);

        if (updateError) {
          throw new Error(
            `QuickBooks created the payment, but the Hub could not save the QuickBooks payment ID: ${updateError.message}`
          );
        }

        await logQboSync({
          entityType:
            "customer_payment",
          entityId: payment.id,
          operation:
            "Create Payment",
          status: "Success",
          qboEntityId:
            qboPayment.Id,
          requestPayload: payload,
          responsePayload: {
            Id:
              qboPayment.Id,
            SyncToken:
              qboPayment.SyncToken ||
              null,
            TotalAmt:
              qboPayment.TotalAmt ??
              paymentAmount,
            UnappliedAmt:
              qboPayment.UnappliedAmt ??
              null,
          },
          createdBy: user.id,
        });

        return NextResponse.json({
          status: "success",
          operation:
            "Create Payment",
          payment_id:
            payment.id,
          qbo_payment_id:
            qboPayment.Id,
          qbo_sync_token:
            qboPayment.SyncToken ||
            null,
          qbo_total:
            qboPayment.TotalAmt ??
            paymentAmount,
          qbo_unapplied:
            qboPayment.UnappliedAmt ??
            null,
          qbo_company:
            connection.company_name,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown customer payment sync error";

        await logQboSync({
          entityType:
            "customer_payment",
          entityId: payment.id,
          operation:
            "Create Payment",
          status: "Failed",
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

    if (action === "sync_invoice") {
      const salesOrderId =
        String(
          body?.sales_order_id || ""
        ).trim();

      if (!salesOrderId) {
        return NextResponse.json(
          {
            error:
              "sales_order_id is required.",
          },
          {
            status: 400,
          }
        );
      }

      const admin = adminSupabase();

      const {
        data: saleData,
        error: saleError,
      } = await admin
        .from("sales_orders")
        .select(
          "id,sale_number,client_id,status,order_date,customer_po,notes,ship_to_address,ship_to_city,ship_to_state,ship_to_zip,delivery_notes,freight_amount,adjustment_amount,tax_amount,qbo_invoice_id,qbo_sync_token,qbo_synced_at"
        )
        .eq("id", salesOrderId)
        .single();

      if (saleError || !saleData) {
        return NextResponse.json(
          {
            error:
              saleError?.message ||
              "Sales Order not found.",
          },
          {
            status: 404,
          }
        );
      }

      const sale =
        saleData as HubSalesOrder;

      if (sale.qbo_invoice_id) {
        return NextResponse.json(
          {
            status: "already_synced",
            error:
              "This Sales Order has already been pushed to QuickBooks. The Hub will not create a duplicate invoice.",
            qbo_invoice_id:
              sale.qbo_invoice_id,
          },
          {
            status: 409,
          }
        );
      }

      const {
        data: clientData,
        error: clientError,
      } = await admin
        .from("clients")
        .select(
          "id,client_name,company_name,email,qbo_customer_id"
        )
        .eq("id", sale.client_id)
        .single();

      if (
        clientError ||
        !clientData
      ) {
        return NextResponse.json(
          {
            error:
              clientError?.message ||
              "Sales Order client could not be loaded.",
          },
          {
            status: 409,
          }
        );
      }

      if (!clientData.qbo_customer_id) {
        return NextResponse.json(
          {
            status:
              "prerequisite_required",
            prerequisite:
              "customer_sync",
            error:
              "This client must be synced to QuickBooks before the Sales Order can be pushed.",
            client_id: sale.client_id,
          },
          {
            status: 409,
          }
        );
      }

      const {
        data: itemData,
        error: itemError,
      } = await admin
        .from("sales_order_items")
        .select(
          "id,manufacturer_id,sort_order,quantity,sku,description,finish,fabric_name,grade,additional_details,unit_price"
        )
        .eq(
          "sales_order_id",
          sale.id
        )
        .order("sort_order", {
          ascending: true,
        });

      if (itemError) {
        return NextResponse.json(
          {
            error: itemError.message,
          },
          {
            status: 500,
          }
        );
      }

      const items =
        (itemData ||
          []) as HubSalesOrderItem[];

      if (!items.length) {
        return NextResponse.json(
          {
            error:
              "This Sales Order has no merchandise lines.",
          },
          {
            status: 409,
          }
        );
      }

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

      try {
        const merchandiseMapping =
          await loadQboMapping(
            connection.id,
            "sales_item",
            "merchandise"
          );

        const freightAmount =
          moneyNumber(
            sale.freight_amount
          );

        const adjustmentAmount =
          moneyNumber(
            sale.adjustment_amount
          );

        const taxAmount =
          moneyNumber(
            sale.tax_amount
          );

        const freightMapping =
          freightAmount !== 0
            ? await loadQboMapping(
                connection.id,
                "sales_item",
                "freight"
              )
            : null;

        const adjustmentMapping =
          adjustmentAmount !== 0
            ? await loadQboMapping(
                connection.id,
                "sales_item",
                "adjustment"
              )
            : null;

        const taxMapping =
          taxAmount !== 0
            ? await loadQboMapping(
                connection.id,
                "tax_code",
                "sales_tax"
              )
            : null;

        const missing: Array<{
          mapping_type: string;
          local_key: string;
          purpose: string;
        }> = [];

        if (!merchandiseMapping) {
          missing.push({
            mapping_type:
              "sales_item",
            local_key:
              "merchandise",
            purpose:
              "Merchandise sales item",
          });
        }

        if (
          freightAmount !== 0 &&
          !freightMapping
        ) {
          missing.push({
            mapping_type:
              "sales_item",
            local_key:
              "freight",
            purpose:
              "Freight sales item",
          });
        }

        if (
          adjustmentAmount !== 0 &&
          !adjustmentMapping
        ) {
          missing.push({
            mapping_type:
              "sales_item",
            local_key:
              "adjustment",
            purpose:
              "Adjustment sales item",
          });
        }

        if (
          taxAmount !== 0 &&
          !taxMapping
        ) {
          missing.push({
            mapping_type:
              "tax_code",
            local_key:
              "sales_tax",
            purpose:
              "Sales tax code",
          });
        }

        if (missing.length) {
          await logQboSync({
            entityType:
              "sales_order",
            entityId: sale.id,
            operation:
              "Create Invoice",
            status:
              "Needs Mapping",
            requestPayload: {
              missing_mappings:
                missing,
            },
            createdBy: user.id,
          });

          return NextResponse.json(
            {
              status:
                "mapping_required",
              error:
                "QuickBooks mapping setup is required before this Sales Order can be pushed.",
              missing_mappings:
                missing,
            },
            {
              status: 409,
            }
          );
        }

        const lines: Array<
          Record<string, unknown>
        > = items
          .slice()
          .sort(
            (a, b) =>
              Number(
                a.sort_order || 0
              ) -
              Number(
                b.sort_order || 0
              )
          )
          .map((item) => {
            const qty = Math.max(
              0,
              Number(
                item.quantity || 0
              )
            );

            const unitPrice =
              moneyNumber(
                item.unit_price
              );

            return {
              Description:
                buildInvoiceDescription(
                  item
                ),
              Amount:
                moneyNumber(
                  qty * unitPrice
                ),
              DetailType:
                "SalesItemLineDetail",
              SalesItemLineDetail: {
                ItemRef: {
                  value:
                    merchandiseMapping!
                      .qbo_entity_id,
                  ...(merchandiseMapping
                    ?.qbo_entity_name
                    ? {
                        name:
                          merchandiseMapping
                            .qbo_entity_name,
                      }
                    : {}),
                },
                Qty: qty,
                UnitPrice:
                  unitPrice,
              },
            };
          })
          .filter(
            (line) =>
              Number(
                line.Amount || 0
              ) !== 0
          );

        if (freightAmount !== 0) {
          lines.push({
            Description:
              "Freight",
            Amount:
              freightAmount,
            DetailType:
              "SalesItemLineDetail",
            SalesItemLineDetail: {
              ItemRef: {
                value:
                  freightMapping!
                    .qbo_entity_id,
                ...(freightMapping
                  ?.qbo_entity_name
                  ? {
                      name:
                        freightMapping
                          .qbo_entity_name,
                    }
                  : {}),
              },
              Qty: 1,
              UnitPrice:
                freightAmount,
            },
          });
        }

        if (
          adjustmentAmount !== 0
        ) {
          lines.push({
            Description:
              "Sales Adjustment",
            Amount:
              adjustmentAmount,
            DetailType:
              "SalesItemLineDetail",
            SalesItemLineDetail: {
              ItemRef: {
                value:
                  adjustmentMapping!
                    .qbo_entity_id,
                ...(adjustmentMapping
                  ?.qbo_entity_name
                  ? {
                      name:
                        adjustmentMapping
                          .qbo_entity_name,
                    }
                  : {}),
              },
              Qty: 1,
              UnitPrice:
                adjustmentAmount,
            },
          });
        }

        const payload:
          Record<string, unknown> = {
            CustomerRef: {
              value:
                clientData.qbo_customer_id,
            },
            DocNumber:
              cleanQboText(
                `DP-${sale.sale_number}`,
                21
              ),
            TxnDate:
              sale.order_date,
            Line: lines,
            PrivateNote:
              cleanQboText(
                [
                  `Designer’s Patio Hub Sales Order ${sale.sale_number}`,
                  sale.customer_po
                    ? `Customer PO: ${sale.customer_po}`
                    : "",
                  sale.delivery_notes
                    ? `Delivery: ${sale.delivery_notes}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" | "),
                4000
              ),
            ...(sale.notes?.trim()
              ? {
                  CustomerMemo: {
                    value:
                      cleanQboText(
                        sale.notes,
                        1000
                      ),
                  },
                }
              : {}),
            ...(clientData.email?.trim()
              ? {
                  BillEmail: {
                    Address:
                      cleanQboText(
                        clientData.email,
                        100
                      ),
                  },
                }
              : {}),
            ...(
              sale.ship_to_address?.trim() ||
              sale.ship_to_city?.trim() ||
              sale.ship_to_state?.trim() ||
              sale.ship_to_zip?.trim()
                ? {
                    ShipAddr: {
                      ...(sale.ship_to_address?.trim()
                        ? {
                            Line1:
                              cleanQboText(
                                sale.ship_to_address,
                                500
                              ),
                          }
                        : {}),
                      ...(sale.ship_to_city?.trim()
                        ? {
                            City:
                              cleanQboText(
                                sale.ship_to_city,
                                255
                              ),
                          }
                        : {}),
                      ...(sale.ship_to_state?.trim()
                        ? {
                            CountrySubDivisionCode:
                              cleanQboText(
                                sale.ship_to_state,
                                255
                              ),
                          }
                        : {}),
                      ...(sale.ship_to_zip?.trim()
                        ? {
                            PostalCode:
                              cleanQboText(
                                sale.ship_to_zip,
                                30
                              ),
                          }
                        : {}),
                      Country: "USA",
                    },
                  }
                : {}
            ),
            ...(taxAmount !== 0 &&
            taxMapping
              ? {
                  TxnTaxDetail: {
                    TotalTax:
                      taxAmount,
                    TxnTaxCodeRef: {
                      value:
                        taxMapping
                          .qbo_entity_id,
                      ...(taxMapping
                        .qbo_entity_name
                        ? {
                            name:
                              taxMapping
                                .qbo_entity_name,
                          }
                        : {}),
                    },
                  },
                }
              : {}),
          };

        const result =
          await qboJsonRequest(
            connection,
            qboCompanyPath(
              connection.realm_id,
              "invoice"
            ),
            {
              method: "POST",
              body: JSON.stringify(
                payload
              ),
            }
          );

        connection =
          result.connection;

        const invoice =
          result.data
            ?.Invoice as
            | QboInvoice
            | undefined;

        if (!invoice?.Id) {
          throw new Error(
            "QuickBooks did not return the created invoice."
          );
        }

        const now =
          new Date().toISOString();

        const {
          error: updateError,
        } = await admin
          .from("sales_orders")
          .update({
            qbo_invoice_id:
              invoice.Id,
            qbo_sync_token:
              invoice.SyncToken ||
              null,
            qbo_synced_at: now,
          })
          .eq("id", sale.id);

        if (updateError) {
          throw new Error(
            `QuickBooks created the invoice, but the Hub could not save the QuickBooks invoice ID: ${updateError.message}`
          );
        }

        await logQboSync({
          entityType:
            "sales_order",
          entityId: sale.id,
          operation:
            "Create Invoice",
          status: "Success",
          qboEntityId:
            invoice.Id,
          requestPayload: payload,
          responsePayload: {
            Id: invoice.Id,
            SyncToken:
              invoice.SyncToken ||
              null,
            DocNumber:
              invoice.DocNumber ||
              null,
            TotalAmt:
              invoice.TotalAmt ??
              null,
            Balance:
              invoice.Balance ??
              null,
          },
          createdBy: user.id,
        });

        return NextResponse.json({
          status: "success",
          operation:
            "Create Invoice",
          sales_order_id:
            sale.id,
          sale_number:
            sale.sale_number,
          qbo_invoice_id:
            invoice.Id,
          qbo_doc_number:
            invoice.DocNumber ||
            null,
          qbo_total:
            invoice.TotalAmt ??
            null,
          qbo_balance:
            invoice.Balance ??
            null,
          qbo_company:
            connection.company_name,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown invoice sync error";

        await logQboSync({
          entityType:
            "sales_order",
          entityId: sale.id,
          operation:
            "Create Invoice",
          status: "Failed",
          errorMessage:
            message,
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

    if (action === "sync_vendor") {
      const manufacturerId =
        String(
          body?.manufacturer_id || ""
        ).trim();

      const requestedMatchId =
        String(
          body?.match_qbo_vendor_id ||
            ""
        ).trim();

      const forceCreate =
        body?.force_create === true;

      if (!manufacturerId) {
        return NextResponse.json(
          {
            error:
              "manufacturer_id is required.",
          },
          {
            status: 400,
          }
        );
      }

      const admin =
        adminSupabase();

      const {
        data: manufacturerData,
        error: manufacturerError,
      } = await admin
        .from("manufacturers")
        .select(
          "id,name,account_number,orders_email,phone,active,qbo_vendor_id,qbo_sync_token,qbo_synced_at"
        )
        .eq("id", manufacturerId)
        .single();

      if (
        manufacturerError ||
        !manufacturerData
      ) {
        return NextResponse.json(
          {
            error:
              manufacturerError?.message ||
              "Hub manufacturer not found.",
          },
          {
            status: 404,
          }
        );
      }

      const manufacturer =
        manufacturerData as HubManufacturer;

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

      let existingVendor:
        QboVendor | null = null;

      let operationContext =
        manufacturer.qbo_vendor_id
          ? "Update Vendor"
          : "Create Vendor";

      try {
        if (
          manufacturer.qbo_vendor_id
        ) {
          const loaded =
            await loadQboVendorById(
              connection,
              manufacturer.qbo_vendor_id
            );

          existingVendor =
            loaded.vendor;
          connection =
            loaded.connection;
        } else if (requestedMatchId) {
          const loaded =
            await loadQboVendorById(
              connection,
              requestedMatchId
            );

          existingVendor =
            loaded.vendor;
          connection =
            loaded.connection;
          operationContext =
            "Link & Update Vendor";
        } else if (!forceCreate) {
          const loaded =
            await loadAllQboVendors(
              connection
            );

          connection =
            loaded.connection;

          const scored =
            loaded.vendors
              .map((vendor) => ({
                vendor,
                score:
                  vendorCandidateScore(
                    manufacturer,
                    vendor
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
            existingVendor =
              strongest[0].vendor;
            operationContext =
              "Auto-Link & Update Vendor";
          } else {
            const reviewMatches =
              scored.filter(
                (entry) =>
                  entry.score >= 4
              );

            if (
              strongest.length > 1 ||
              reviewMatches.length > 0
            ) {
              const candidates =
                scored
                  .slice(0, 5)
                  .map((entry) =>
                    sanitizedVendorCandidate(
                      entry.vendor,
                      entry.score
                    )
                  );

              await logQboSync({
                entityType:
                  "manufacturer",
                entityId:
                  manufacturer.id,
                operation:
                  "Match Vendor",
                status:
                  "Needs Review",
                requestPayload: {
                  manufacturer_name:
                    manufacturer.name,
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
                  manufacturer_id:
                    manufacturer.id,
                  manufacturer_name:
                    manufacturer.name,
                  candidates,
                },
                {
                  status: 409,
                }
              );
            }
          }
        }

        if (existingVendor?.Id) {
          const loaded =
            await loadQboVendorById(
              connection,
              existingVendor.Id
            );

          existingVendor =
            loaded.vendor;
          connection =
            loaded.connection;
        }

        const saved =
          await saveQboVendor(
            connection,
            manufacturer,
            existingVendor
          );

        connection =
          saved.connection;

        const now =
          new Date().toISOString();

        const { error: updateError } =
          await admin
            .from("manufacturers")
            .update({
              qbo_vendor_id:
                saved.vendor.Id,
              qbo_sync_token:
                saved.vendor.SyncToken ||
                null,
              qbo_synced_at: now,
            })
            .eq(
              "id",
              manufacturer.id
            );

        if (updateError) {
          throw new Error(
            `QuickBooks saved the vendor, but the Hub could not save the QuickBooks mapping: ${updateError.message}`
          );
        }

        await logQboSync({
          entityType:
            "manufacturer",
          entityId:
            manufacturer.id,
          operation:
            operationContext,
          status: "Success",
          qboEntityId:
            saved.vendor.Id,
          requestPayload:
            saved.requestPayload,
          responsePayload: {
            Id:
              saved.vendor.Id,
            SyncToken:
              saved.vendor.SyncToken ||
              null,
            DisplayName:
              saved.vendor.DisplayName ||
              manufacturer.name,
          },
          createdBy: user.id,
        });

        return NextResponse.json({
          status: "success",
          operation:
            operationContext,
          manufacturer_id:
            manufacturer.id,
          qbo_vendor_id:
            saved.vendor.Id,
          qbo_sync_token:
            saved.vendor.SyncToken ||
            null,
          qbo_display_name:
            saved.vendor.DisplayName ||
            manufacturer.name,
          qbo_company:
            connection.company_name,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown vendor sync error";

        await logQboSync({
          entityType:
            "manufacturer",
          entityId:
            manufacturer.id,
          operation:
            operationContext,
          status: "Failed",
          qboEntityId:
            manufacturer.qbo_vendor_id ||
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
