import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEAM_ROLES = [
  "Owner",
  "Manager",
  "Assistant Manager",
  "Warranty Manager",
  "Shipping / Accounting",
  "Administrative",
] as const;

type TeamRole =
  (typeof TEAM_ROLES)[number];

function env(name: string) {
  const value =
    process.env[name]?.trim();

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
    env(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    ),
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
    request.headers.get(
      "authorization"
    ) || "";

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  const token =
    authorization.slice(7).trim();

  if (!token) return null;

  const supabase =
    publicSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(
    token
  );

  if (error || !user) {
    return null;
  }

  const admin =
    adminSupabase();

  const {
    data: profile,
    error: profileError,
  } = await admin
    .from("profiles")
    .select(
      "id,display_name,email,phone,role,default_commission_rate,active"
    )
    .eq("id", user.id)
    .single();

  if (
    profileError ||
    !profile ||
    profile.active === false
  ) {
    return null;
  }

  return {
    user,
    profile,
  };
}

function normalizeRole(
  value: unknown
): TeamRole {
  const role =
    String(value || "").trim();

  if (
    !TEAM_ROLES.includes(
      role as TeamRole
    )
  ) {
    throw new Error(
      "Choose a valid team role."
    );
  }

  return role as TeamRole;
}

function normalizeCommission(
  value: unknown
) {
  const parsed =
    Number(value ?? 0);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > 100
  ) {
    throw new Error(
      "Commission rate must be between 0 and 100."
    );
  }

  return (
    Math.round(parsed * 10000) /
    10000
  );
}

function temporaryPassword() {
  return `DP-${randomBytes(8).toString(
    "base64url"
  )}!9a`;
}

async function listTeam() {
  const admin =
    adminSupabase();

  const { data, error } =
    await admin
      .from("profiles")
      .select(
        "id,display_name,email,phone,role,default_commission_rate,active"
      )
      .order("active", {
        ascending: false,
      })
      .order("display_name", {
        ascending: true,
      });

  if (error) {
    throw new Error(
      `Could not load team: ${error.message}`
    );
  }

  return data || [];
}

export async function POST(
  request: Request
) {
  try {
    const actor =
      await authenticatedHubUser(
        request
      );

    if (!actor) {
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
      String(
        body?.action || ""
      ).trim();

    if (action === "list") {
      return NextResponse.json({
        team:
          await listTeam(),
        roles: TEAM_ROLES,
      });
    }

    if (
      action === "create"
    ) {
      const displayName =
        String(
          body?.display_name || ""
        ).trim();

      const email =
        String(
          body?.email || ""
        )
          .trim()
          .toLowerCase();

      const phone =
        String(
          body?.phone || ""
        ).trim();

      const role =
        normalizeRole(body?.role);

      const commission =
        normalizeCommission(
          body?.default_commission_rate
        );

      if (!displayName) {
        return NextResponse.json(
          {
            error:
              "Team member name is required.",
          },
          {
            status: 400,
          }
        );
      }

      if (
        !email ||
        !email.includes("@")
      ) {
        return NextResponse.json(
          {
            error:
              "A valid email address is required.",
          },
          {
            status: 400,
          }
        );
      }

      const admin =
        adminSupabase();

      const tempPassword =
        temporaryPassword();

      const {
        data: created,
        error: authError,
      } = await admin.auth.admin
        .createUser({
          email,
          password:
            tempPassword,
          email_confirm: true,
          user_metadata: {
            display_name:
              displayName,
          },
        });

      if (
        authError ||
        !created.user
      ) {
        return NextResponse.json(
          {
            error:
              authError?.message ||
              "Could not create the team login.",
          },
          {
            status: 400,
          }
        );
      }

      const {
        error: profileError,
      } = await admin
        .from("profiles")
        .upsert({
          id:
            created.user.id,
          display_name:
            displayName,
          email,
          phone:
            phone || null,
          role,
          default_commission_rate:
            commission,
          active: true,
        });

      if (profileError) {
        await admin.auth.admin
          .deleteUser(
            created.user.id
          )
          .catch(() => undefined);

        return NextResponse.json(
          {
            error:
              `Login creation was rolled back because the team profile could not be saved: ${profileError.message}`,
          },
          {
            status: 400,
          }
        );
      }

      return NextResponse.json({
        status: "success",
        user: {
          id:
            created.user.id,
          display_name:
            displayName,
          email,
          phone:
            phone || null,
          role,
          default_commission_rate:
            commission,
          active: true,
        },
        temporary_password:
          tempPassword,
      });
    }

    if (
      action === "update"
    ) {
      const userId =
        String(
          body?.user_id || ""
        ).trim();

      if (!userId) {
        return NextResponse.json(
          {
            error:
              "user_id is required.",
          },
          {
            status: 400,
          }
        );
      }

      const admin =
        adminSupabase();

      const {
        data: existing,
        error: existingError,
      } = await admin
        .from("profiles")
        .select(
          "id,display_name,email,phone,role,default_commission_rate,active"
        )
        .eq("id", userId)
        .single();

      if (
        existingError ||
        !existing
      ) {
        return NextResponse.json(
          {
            error:
              existingError
                ?.message ||
              "Team member not found.",
          },
          {
            status: 404,
          }
        );
      }

      const displayName =
        String(
          body?.display_name ??
            existing.display_name ??
            ""
        ).trim();

      const phone =
        String(
          body?.phone ??
            existing.phone ??
            ""
        ).trim();

      const role =
        normalizeRole(
          body?.role ??
            existing.role
        );

      const commission =
        normalizeCommission(
          body?.default_commission_rate ??
            existing.default_commission_rate
        );

      const active =
        body?.active === undefined
          ? existing.active !==
            false
          : body.active === true;

      if (!displayName) {
        return NextResponse.json(
          {
            error:
              "Team member name is required.",
          },
          {
            status: 400,
          }
        );
      }

      if (
        userId ===
          actor.user.id &&
        !active
      ) {
        return NextResponse.json(
          {
            error:
              "You cannot deactivate your own Hub account.",
          },
          {
            status: 400,
          }
        );
      }

      const {
        data: updated,
        error,
      } = await admin
        .from("profiles")
        .update({
          display_name:
            displayName,
          phone:
            phone || null,
          role,
          default_commission_rate:
            commission,
          active,
        })
        .eq("id", userId)
        .select(
          "id,display_name,email,phone,role,default_commission_rate,active"
        )
        .single();

      if (error) {
        return NextResponse.json(
          {
            error:
              error.message,
          },
          {
            status: 400,
          }
        );
      }

      return NextResponse.json({
        status: "success",
        user: updated,
      });
    }

    if (
      action ===
      "reset_password"
    ) {
      const userId =
        String(
          body?.user_id || ""
        ).trim();

      if (!userId) {
        return NextResponse.json(
          {
            error:
              "user_id is required.",
          },
          {
            status: 400,
          }
        );
      }

      const admin =
        adminSupabase();

      const {
        data: profile,
        error:
          profileError,
      } = await admin
        .from("profiles")
        .select(
          "id,email,display_name"
        )
        .eq("id", userId)
        .single();

      if (
        profileError ||
        !profile
      ) {
        return NextResponse.json(
          {
            error:
              profileError
                ?.message ||
              "Team member not found.",
          },
          {
            status: 404,
          }
        );
      }

      const tempPassword =
        temporaryPassword();

      const {
        error: authError,
      } = await admin.auth.admin
        .updateUserById(
          userId,
          {
            password:
              tempPassword,
          }
        );

      if (authError) {
        return NextResponse.json(
          {
            error:
              authError.message,
          },
          {
            status: 400,
          }
        );
      }

      return NextResponse.json({
        status: "success",
        user_id: userId,
        email:
          profile.email,
        display_name:
          profile.display_name,
        temporary_password:
          tempPassword,
      });
    }

    return NextResponse.json(
      {
        error:
          "Unknown team action.",
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
            : "Team server error",
      },
      {
        status: 500,
      }
    );
  }
}
