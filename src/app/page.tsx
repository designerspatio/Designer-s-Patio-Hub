"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

type Profile = {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  default_commission_rate: number;
  active: boolean;
};

export default function Home() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    return url && key ? createClient(url, key) : null;
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("jgibson@designerspatio.com");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setMessage("Supabase connection settings are missing.");
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    async function loadProfile() {
      if (!supabase || !session?.user?.id) {
        setProfile(null);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, display_name, email, role, default_commission_rate, active"
        )
        .eq("id", session.user.id)
        .single();

      if (error) {
        setMessage(`Profile error: ${error.message}`);
        return;
      }

      setProfile(data as Profile);
    }

    loadProfile();
  }, [supabase, session?.user?.id]);

  async function signIn() {
    if (!supabase) return;

    if (!email || !password) {
      setMessage("Enter your email and password.");
      return;
    }

    setMessage("Signing in...");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setPassword("");
    setMessage("");
  }

  async function sendMagicLink() {
    if (!supabase) return;

    if (!email) {
      setMessage("Enter your work email first.");
      return;
    }

    setMessage("Sending sign-in link...");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: false,
      },
    });

    setMessage(
      error
        ? error.message
        : "Check your email for the newest sign-in link."
    );
  }

  async function signOut() {
    if (!supabase) return;

    await supabase.auth.signOut();
    setProfile(null);
    setPassword("");
    setMessage("");
  }

  if (loading) {
    return (
      <main style={styles.center}>
        <section style={styles.card}>
          Connecting to Designer’s Patio Hub...
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main style={styles.center}>
        <section style={styles.loginCard}>
          <div style={styles.logo}>DP</div>

          <h1 style={styles.title}>Designer’s Patio Hub</h1>

          <p style={styles.muted}>
            Sales • CRM • Inventory • Purchasing
          </p>

          <div style={styles.rule} />

          <label style={styles.label}>Work email</label>

          <input
            style={styles.input}
            type="email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />

          <label style={styles.label}>Password</label>

          <input
            style={styles.input}
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") signIn();
            }}
          />

          <button
            style={styles.primaryButton}
            onClick={signIn}
          >
            Sign in
          </button>

          <button
            style={styles.magicButton}
            onClick={sendMagicLink}
          >
            Email me a sign-in link instead
          </button>

          {message && (
            <div style={styles.message}>{message}</div>
          )}

          <p style={styles.footnote}>
            Designer’s Patio internal access only.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.center}>
      <section style={styles.dashboard}>
        <div style={styles.topRow}>
          <div>
            <div style={styles.logo}>DP</div>

            <div style={styles.roleBadge}>
              {profile?.role || "Loading role..."}
            </div>
          </div>

          <button
            style={styles.signOutButton}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>

        <h1 style={styles.title}>
          Welcome,{" "}
          {profile?.display_name?.split(" ")[0] ||
            session.user.email}
        </h1>

        <p style={styles.muted}>
          Your account is connected to the live Designer’s Patio Hub.
        </p>

        <div style={styles.infoBox}>
          <div>
            <span style={styles.infoLabel}>User</span>
            <strong>
              {profile?.display_name || "Loading..."}
            </strong>
          </div>

          <div>
            <span style={styles.infoLabel}>Role</span>
            <strong>
              {profile?.role || "Loading..."}
            </strong>
          </div>

          <div>
            <span style={styles.infoLabel}>
              Default commission
            </span>
            <strong>
              {(
                (profile?.default_commission_rate || 0.02) *
                100
              ).toFixed(0)}
              %
            </strong>
          </div>

          <div>
            <span style={styles.infoLabel}>Account</span>
            <strong>
              {profile?.active === false
                ? "Inactive"
                : "Active"}
            </strong>
          </div>
        </div>

        <div style={styles.successBox}>
          <strong>✓ Authentication connected</strong>
          <br />
          Your Vercel app, Supabase login, and employee profile
          are talking to each other.
        </div>

        {message && (
          <div style={styles.message}>{message}</div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  center: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 20,
    background:
      "radial-gradient(circle at top right, rgba(57,125,172,.18), transparent 35rem), #f4f7f9",
  },

  loginCard: {
    width: "100%",
    maxWidth: 460,
    boxSizing: "border-box",
    background: "white",
    border: "1px solid #dde6eb",
    borderRadius: 22,
    padding: 28,
    boxShadow: "0 18px 50px rgba(20,50,72,.11)",
  },

  dashboard: {
    width: "100%",
    maxWidth: 650,
    boxSizing: "border-box",
    background: "white",
    border: "1px solid #dde6eb",
    borderRadius: 22,
    padding: 28,
    boxShadow: "0 18px 50px rgba(20,50,72,.11)",
  },

  card: {
    background: "white",
    padding: 25,
    borderRadius: 18,
  },

  logo: {
    width: 52,
    height: 52,
    borderRadius: 16,
    background:
      "linear-gradient(145deg,#163a58,#397dac)",
    color: "white",
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    marginBottom: 15,
  },

  title: {
    margin: "0 0 6px",
    color: "#173a59",
  },

  muted: {
    color: "#6e7b85",
    lineHeight: 1.5,
  },

  rule: {
    height: 1,
    background: "#e4eaee",
    margin: "22px 0",
  },

  label: {
    display: "block",
    fontWeight: 800,
    fontSize: 12,
    color: "#52626f",
    marginBottom: 7,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cfdbe2",
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 14,
  },

  primaryButton: {
    width: "100%",
    border: 0,
    background: "#173a59",
    color: "white",
    fontWeight: 800,
    borderRadius: 10,
    padding: 12,
    cursor: "pointer",
  },

  magicButton: {
    width: "100%",
    border: "1px solid #cfdbe2",
    background: "white",
    color: "#285475",
    fontWeight: 800,
    borderRadius: 10,
    padding: 11,
    cursor: "pointer",
    marginTop: 10,
  },

  message: {
    marginTop: 14,
    padding: 11,
    background: "#eef6fb",
    borderRadius: 9,
    color: "#285475",
  },

  footnote: {
    marginBottom: 0,
    marginTop: 18,
    textAlign: "center",
    color: "#8a969e",
    fontSize: 11,
  },

  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 15,
  },

  roleBadge: {
    display: "inline-block",
    background: "#e8f1f7",
    color: "#285475",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    marginBottom: 12,
  },

  infoBox: {
    background: "#f4f7f9",
    borderRadius: 14,
    padding: 18,
    display: "grid",
    gap: 16,
    marginTop: 22,
    color: "#334a5c",
  },

  infoLabel: {
    display: "block",
    color: "#7a8790",
    fontSize: 10,
    fontWeight: 800,
    textTransform: "uppercase",
    marginBottom: 3,
  },

  successBox: {
    marginTop: 18,
    background: "#edf7f2",
    color: "#27634f",
    borderRadius: 12,
    padding: 15,
    lineHeight: 1.5,
  },

  signOutButton: {
    border: "1px solid #ccd8df",
    background: "white",
    color: "#173a59",
    fontWeight: 800,
    borderRadius: 10,
    padding: "9px 12px",
    cursor: "pointer",
  },
};
