"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

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

  async function loadProfile(userId: string) {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, display_name, email, role, default_commission_rate, active"
      )
      .eq("id", userId)
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    setProfile(data as Profile);
  }

  useEffect(() => {
    if (!supabase) {
      setMessage("Supabase environment variables are missing.");
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);

      if (data.session?.user?.id) {
        await loadProfile(data.session.user.id);
      }

      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        setSession(nextSession);

        if (nextSession?.user?.id) {
          await loadProfile(nextSession.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  async function sendMagicLink() {
    if (!supabase) return;

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
        : "Check your email and open the newest sign-in link."
    );
  }

  async function savePassword() {
    if (!supabase) return;

    if (password.length < 8) {
      setMessage("Use at least 8 characters for your password.");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setPassword("");
    setMessage("Password saved.");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  if (loading) {
    return (
      <main style={styles.center}>
        <div style={styles.card}>Connecting to Designer’s Patio Hub...</div>
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
            onChange={(e) => setEmail(e.target.value)}
          />

          <button style={styles.primaryButton} onClick={sendMagicLink}>
            Email me a sign-in link
          </button>

          {message && <div style={styles.message}>{message}</div>}
        </section>
      </main>
    );
  }

  return (
    <main style={styles.center}>
      <section style={styles.dashboard}>
        <div style={styles.logo}>DP</div>

        <div style={styles.roleBadge}>
          {profile?.role || "Loading role..."}
        </div>

        <h1 style={styles.title}>
          Welcome, {profile?.display_name || session.user.email}
        </h1>

        <p style={styles.muted}>
          Your account is connected to the live Designer’s Patio database.
        </p>

        <div style={styles.infoBox}>
          <strong>User:</strong> {profile?.display_name || "Loading..."}
          <br />
          <strong>Role:</strong> {profile?.role || "Loading..."}
          <br />
          <strong>Default commission:</strong>{" "}
          {((profile?.default_commission_rate || 0.02) * 100).toFixed(0)}%
          <br />
          <strong>Status:</strong>{" "}
          {profile?.active === false ? "Inactive" : "Active"}
        </div>

        <h2 style={styles.subheading}>Create your password</h2>

        <input
          style={styles.input}
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button style={styles.primaryButton} onClick={savePassword}>
          Save password
        </button>

        {message && <div style={styles.message}>{message}</div>}

        <button style={styles.signOutButton} onClick={signOut}>
          Sign out
        </button>
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
    background: "white",
    border: "1px solid #dde6eb",
    borderRadius: 22,
    padding: 28,
    boxShadow: "0 18px 50px rgba(20,50,72,.11)",
  },

  dashboard: {
    width: "100%",
    maxWidth: 650,
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
    background: "linear-gradient(145deg,#163a58,#397dac)",
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
    padding: "12px",
    fontSize: 16,
    marginBottom: 12,
  },

  primaryButton: {
    width: "100%",
    border: 0,
    background: "#173a59",
    color: "white",
    fontWeight: 800,
    borderRadius: 10,
    padding: "12px",
    cursor: "pointer",
  },

  message: {
    marginTop: 14,
    padding: 11,
    background: "#eef6fb",
    borderRadius: 9,
    color: "#285475",
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
    borderRadius: 12,
    padding: 15,
    lineHeight: 1.8,
    margin: "20px 0",
    color: "#334a5c",
  },

  subheading: {
    color: "#173a59",
    fontSize: 18,
    marginTop: 25,
  },

  signOutButton: {
    width: "100%",
    marginTop: 12,
    border: "1px solid #ccd8df",
    background: "white",
    color: "#173a59",
    fontWeight: 800,
    borderRadius: 10,
    padding: "11px",
    cursor: "pointer",
  },
};
