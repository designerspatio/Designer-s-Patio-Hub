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
