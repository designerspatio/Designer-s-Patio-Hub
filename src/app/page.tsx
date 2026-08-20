"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

type View = "dashboard" | "clients";

type Profile = {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  default_commission_rate: number;
  active: boolean;
};

type Client = {
  id: string;
  client_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  business_type: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  street_address: string | null;
  lead_status: string | null;
  notes: string | null;
  tax_exempt: boolean | null;
  active: boolean | null;
};

const clientColumns =
  "id,client_name,first_name,last_name,company_name,business_type,email,phone,city,state,zip_code,street_address,lead_status,notes,tax_exempt,active";

function getClientName(client: Client) {
  if (client.client_name) return client.client_name;
  if (client.company_name) return client.company_name;

  const personalName = [client.first_name, client.last_name]
    .filter(Boolean)
    .join(" ");

  return personalName || "Unnamed client";
}

function getLocation(client: Client) {
  const cityState = [client.city, client.state]
    .filter(Boolean)
    .join(", ");

  return [cityState, client.zip_code].filter(Boolean).join(" ");
}

export default function Home() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    return url && key ? createClient(url, key) : null;
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] =
    useState<Client | null>(null);

  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(false);

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
          "id,display_name,email,role,default_commission_rate,active"
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

  useEffect(() => {
    async function loadClients() {
      if (!supabase || !session?.user?.id) {
        setClients([]);
        return;
      }

      setClientsLoading(true);

      const { data, error } = await supabase
        .from("clients")
        .select(clientColumns)
        .order("client_name", { ascending: true })
        .limit(1000);

      if (error) {
        setMessage(`Client error: ${error.message}`);
        setClientsLoading(false);
        return;
      }

      setClients((data || []) as Client[]);
      setClientsLoading(false);
    }

    loadClients();
  }, [supabase, session?.user?.id]);

  const filteredClients = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return clients;

    return clients.filter((client) => {
      const searchable = [
        getClientName(client),
        client.email,
        client.phone,
        client.city,
        client.state,
        client.zip_code,
        client.street_address,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(term);
    });
  }, [clients, search]);

  const clientStats = useMemo(() => {
    const withEmail = clients.filter((client) => client.email).length;
    const withPhone = clients.filter((client) => client.phone).length;

    const states = new Set(
      clients
        .map((client) => client.state)
        .filter((state): state is string => Boolean(state))
    );

    return {
      total: clients.length,
      withEmail,
      withPhone,
      states: states.size,
    };
  }, [clients]);

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
    setClients([]);
    setSelectedClient(null);
    setSearch("");
    setView("dashboard");
    setMessage("");
  }

  function openFutureSection(label: string) {
    setMessage(`${label} is coming next.`);
  }

  if (loading) {
    return (
      <>
        <style>{appCss}</style>
        <main className="login-screen">
          <section className="loading-card">
            Connecting to Designer’s Patio Hub...
          </section>
        </main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <style>{appCss}</style>

        <main className="login-screen">
          <section className="login-card">
            <div className="login-logo">DP</div>

            <div className="eyebrow">DESIGNER’S PATIO</div>

            <h1>Hub</h1>

            <p className="login-subtitle">
              Sales · CRM · Inventory · Purchasing
            </p>

            <div className="login-rule" />

            <label>Work email</label>

            <input
              className="login-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label>Password</label>

            <input
              className="login-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") signIn();
              }}
            />

            <button className="primary-button" onClick={signIn}>
              Sign in
            </button>

            <button
              className="secondary-login-button"
              onClick={sendMagicLink}
            >
              Email me a sign-in link instead
            </button>

            {message && <div className="login-message">{message}</div>}

            <div className="internal-note">
              Designer’s Patio internal access only
            </div>
          </section>
        </main>
      </>
    );
  }

  const firstName =
    profile?.display_name?.split(" ")[0] ||
    session.user.email ||
    "there";

  return (
    <>
      <style>{appCss}</style>

      <div className="hub-shell">
        <aside className="sidebar">
          <div className="brand-area">
            <div className="brand-logo">DP</div>

            <div>
              <div className="brand-name">Designer’s Patio</div>
              <div className="brand-hub">HUB</div>
            </div>
          </div>

          <div className="sidebar-user">
            <div className="sidebar-user-name">
              {profile?.display_name || session.user.email}
            </div>

            <div className="sidebar-role">
              {profile?.role || "Team Member"}
            </div>
          </div>

          <nav className="nav-sections">
            <div className="nav-group">
              <div className="nav-heading">HOME</div>

              <button
                className={`nav-button ${
                  view === "dashboard" ? "active" : ""
                }`}
                onClick={() => {
                  setView("dashboard");
                  setMessage("");
                }}
              >
                <span>⌂</span>
                Dashboard
              </button>
            </div>

            <div className="nav-group">
              <div className="nav-heading">SALES</div>

              <button
                className={`nav-button ${
                  view === "clients" ? "active" : ""
                }`}
                onClick={() => {
                  setView("clients");
                  setMessage("");
                }}
              >
                <span>◉</span>
                Clients
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Client Scanner")}
              >
                <span>▣</span>
                Scan
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Quotes")}
              >
                <span>＋</span>
                Quotes
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Sales Orders")}
              >
                <span>$</span>
                Sales Orders
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Daily Cash")}
              >
                <span>▤</span>
                Daily Cash
              </button>
            </div>

            <div className="nav-group">
              <div className="nav-heading">PRODUCTS</div>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("AI Finder")}
              >
                <span>✦</span>
                AI Finder
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Catalogs")}
              >
                <span>▥</span>
                Catalogs
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Price Lists")}
              >
                <span>≡</span>
                Price Lists
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Inventory")}
              >
                <span>◫</span>
                Inventory
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Manufacturers")}
              >
                <span>◇</span>
                Manufacturers
              </button>
            </div>

            <div className="nav-group">
              <div className="nav-heading">OPERATIONS</div>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Purchase Orders")}
              >
                <span>⇄</span>
                Purchase Orders
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Acknowledgements")}
              >
                <span>✓</span>
                Acknowledgements
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Accounting")}
              >
                <span>Q</span>
                Accounting
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Reports")}
              >
                <span>▥</span>
                Reports
              </button>
            </div>

            <div className="nav-group">
              <div className="nav-heading">ADMIN</div>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Team")}
              >
                <span>♟</span>
                Team
              </button>

              <button
                className="nav-button future"
                onClick={() => openFutureSection("Settings")}
              >
                <span>⚙</span>
                Settings
              </button>
            </div>
          </nav>
        </aside>

        <main className="main-area">
          <header className="topbar">
            <div>
              <div className="topbar-title">
                {view === "dashboard" ? "Dashboard" : "Clients"}
              </div>

              <div className="topbar-subtitle">
                Designer’s Patio Hub
              </div>
            </div>

            <button className="signout-button" onClick={signOut}>
              Sign out
            </button>
          </header>

          {message && (
            <div className="notice">
              {message}

              <button onClick={() => setMessage("")}>×</button>
            </div>
          )}

          {view === "dashboard" && (
            <section>
              <div className="welcome-card">
                <div>
                  <div className="welcome-role">
                    {profile?.role || "Team Member"}
                  </div>

                  <h1>Welcome back, {firstName}.</h1>

                  <p>
                    The Hub is connected and your client directory is
                    officially live.
                  </p>
                </div>

                <button
                  className="welcome-action"
                  onClick={() => setView("clients")}
                >
                  Open Clients →
                </button>
              </div>

              <div className="stats-grid">
                <StatCard
                  label="CLIENTS"
                  value={
                    clientsLoading
                      ? "..."
                      : clientStats.total.toLocaleString()
                  }
                  detail="Live client records"
                />

                <StatCard
                  label="WITH EMAIL"
                  value={clientStats.withEmail.toLocaleString()}
                  detail="Ready for communication"
                />

                <StatCard
                  label="WITH PHONE"
                  value={clientStats.withPhone.toLocaleString()}
                  detail="Phone contacts"
                />

                <StatCard
                  label="STATES"
                  value={clientStats.states.toLocaleString()}
                  detail="Client locations"
                />
              </div>

              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-eyebrow">
                        CLIENT DIRECTORY
                      </div>
                      <h2>Quick access</h2>
                    </div>

                    <button
                      className="text-button"
                      onClick={() => setView("clients")}
                    >
                      View all
                    </button>
                  </div>

                  {clientsLoading ? (
                    <div className="empty-state">
                      Loading clients...
                    </div>
                  ) : (
                    <div className="quick-client-list">
                      {clients.slice(0, 6).map((client) => (
                        <button
                          key={client.id}
                          className="quick-client-row"
                          onClick={() => {
                            setSelectedClient(client);
                            setView("clients");
                          }}
                        >
                          <div className="client-initial">
                            {getClientName(client)
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <div className="quick-client-copy">
                            <strong>{getClientName(client)}</strong>
                            <span>
                              {getLocation(client) ||
                                client.email ||
                                "No location entered"}
                            </span>
                          </div>

                          <span className="chevron">›</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="panel system-panel">
                  <div className="panel-eyebrow">SYSTEM</div>

                  <h2>Hub status</h2>

                  <StatusRow
                    label="Vercel production app"
                    value="Connected"
                  />

                  <StatusRow
                    label="Supabase authentication"
                    value="Connected"
                  />

                  <StatusRow
                    label="Employee profile"
                    value={profile?.role || "Connected"}
                  />

                  <StatusRow
                    label="Client database"
                    value={`${clientStats.total} loaded`}
                  />

                  <div className="commission-box">
                    <span>Your default commission</span>
                    <strong>
                      {(
                        (profile?.default_commission_rate || 0.02) *
                        100
                      ).toFixed(0)}
                      %
                    </strong>
                  </div>
                </section>
              </div>
            </section>
          )}

          {view === "clients" && (
            <section>
              <div className="page-heading">
                <div>
                  <div className="section-eyebrow">
                    CLIENT RELATIONSHIP MANAGEMENT
                  </div>

                  <h1>Clients</h1>

                  <p>
                    {clientStats.total.toLocaleString()} client
                    records in the live Hub.
                  </p>
                </div>

                <button
                  className="disabled-action"
                  onClick={() =>
                    setMessage(
                      "New Client entry is the next part we’ll wire up."
                    )
                  }
                >
                  + New Client
                </button>
              </div>

              <div className="search-card">
                <div className="search-icon">⌕</div>

                <input
                  type="search"
                  placeholder="Search name, city, state, phone, email or address..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                {search && (
                  <button
                    className="clear-search"
                    onClick={() => setSearch("")}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="client-result-bar">
                <span>
                  {filteredClients.length.toLocaleString()}{" "}
                  {filteredClients.length === 1
                    ? "client"
                    : "clients"}
                </span>

                {search && (
                  <span>
                    matching “{search}”
                  </span>
                )}
              </div>

              <div className="client-layout">
                <section className="client-list-panel">
                  {clientsLoading ? (
                    <div className="empty-state">
                      Loading client directory...
                    </div>
                  ) : filteredClients.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">⌕</div>
                      <strong>No clients found</strong>
                      <span>
                        Try a different name, phone number, city or
                        email.
                      </span>
                    </div>
                  ) : (
                    <div className="client-list">
                      {filteredClients.map((client) => (
                        <button
                          key={client.id}
                          className={`client-row ${
                            selectedClient?.id === client.id
                              ? "selected"
                              : ""
                          }`}
                          onClick={() => setSelectedClient(client)}
                        >
                          <div className="client-initial">
                            {getClientName(client)
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <div className="client-row-main">
                            <strong>{getClientName(client)}</strong>

                            <span>
                              {getLocation(client) ||
                                "Location not entered"}
                            </span>
                          </div>

                          <div className="client-row-contact">
                            <span>
                              {client.phone || "No phone"}
                            </span>

                            <span>
                              {client.email || "No email"}
                            </span>
                          </div>

                          <div className="chevron">›</div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <aside className="client-detail-panel">
                  {!selectedClient ? (
                    <div className="detail-placeholder">
                      <div className="detail-placeholder-icon">
                        ◉
                      </div>

                      <h3>Select a client</h3>

                      <p>
                        Choose a client from the directory to view
                        their contact details.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="detail-top">
                        <div className="detail-avatar">
                          {getClientName(selectedClient)
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <div>
                          <div className="detail-kicker">
                            CLIENT
                          </div>

                          <h2>
                            {getClientName(selectedClient)}
                          </h2>

                          {selectedClient.business_type && (
                            <div className="detail-type">
                              {selectedClient.business_type}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="detail-section">
                        <div className="detail-section-title">
                          CONTACT
                        </div>

                        <DetailField
                          label="Phone"
                          value={selectedClient.phone}
                        />

                        <DetailField
                          label="Email"
                          value={selectedClient.email}
                        />
                      </div>

                      <div className="detail-section">
                        <div className="detail-section-title">
                          ADDRESS
                        </div>

                        <DetailField
                          label="Street"
                          value={selectedClient.street_address}
                        />

                        <DetailField
                          label="City"
                          value={selectedClient.city}
                        />

                        <DetailField
                          label="State"
                          value={selectedClient.state}
                        />

                        <DetailField
                          label="ZIP"
                          value={selectedClient.zip_code}
                        />
                      </div>

                      <div className="detail-section">
                        <div className="detail-section-title">
                          ACCOUNT
                        </div>

                        <DetailField
                          label="Status"
                          value={
                            selectedClient.active === false
                              ? "Inactive"
                              : "Active"
                          }
                        />

                        <DetailField
                          label="Tax Exempt"
                          value={
                            selectedClient.tax_exempt
                              ? "Yes"
                              : "Not marked"
                          }
                        />

                        <DetailField
                          label="Lead Status"
                          value={selectedClient.lead_status}
                        />
                      </div>

                      {selectedClient.notes && (
                        <div className="detail-section">
                          <div className="detail-section-title">
                            NOTES
                          </div>

                          <p className="client-notes">
                            {selectedClient.notes}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </aside>
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
    </div>
  );
}

function StatusRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="status-row">
      <div>
        <span className="status-dot">●</span>
        {label}
      </div>

      <strong>{value}</strong>
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="detail-field">
      <span>{label}</span>
      <strong>{value || "Not entered"}</strong>
    </div>
  );
}

const appCss = `
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: #f3f6f8;
    color: #173a59;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
  }

  button,
  input {
    font: inherit;
  }

  button {
    cursor: pointer;
  }

  .login-screen {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
    background:
      radial-gradient(
        circle at top right,
        rgba(54, 126, 174, 0.22),
        transparent 34rem
      ),
      #f2f6f8;
  }

  .login-card,
  .loading-card {
    width: 100%;
    max-width: 460px;
    background: white;
    border: 1px solid #dce6ec;
    border-radius: 24px;
    padding: 30px;
    box-shadow: 0 22px 60px rgba(22, 54, 78, 0.12);
  }

  .loading-card {
    text-align: center;
    font-weight: 800;
  }

  .login-logo,
  .brand-logo {
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #153a58, #3881af);
    color: white;
    font-weight: 900;
  }

  .login-logo {
    width: 58px;
    height: 58px;
    border-radius: 18px;
    margin-bottom: 22px;
  }

  .eyebrow,
  .section-eyebrow,
  .panel-eyebrow,
  .detail-kicker {
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: #78909f;
  }

  .login-card h1 {
    margin: 3px 0 0;
    font-size: 40px;
    color: #173a59;
  }

  .login-subtitle {
    color: #6d7d87;
    margin-top: 4px;
  }

  .login-rule {
    height: 1px;
    background: #e4ebef;
    margin: 24px 0;
  }

  .login-card label {
    display: block;
    color: #526470;
    font-size: 12px;
    font-weight: 800;
    margin-bottom: 7px;
  }

  .login-input {
    width: 100%;
    border: 1px solid #cad9e1;
    border-radius: 11px;
    padding: 12px;
    margin-bottom: 14px;
    outline: none;
  }

  .login-input:focus,
  .search-card input:focus {
    border-color: #367ca8;
    box-shadow: 0 0 0 3px rgba(54, 124, 168, 0.1);
  }

  .primary-button {
    width: 100%;
    border: 0;
    border-radius: 11px;
    padding: 12px;
    background: #173a59;
    color: white;
    font-weight: 850;
  }

  .secondary-login-button {
    width: 100%;
    border: 1px solid #cad9e1;
    border-radius: 11px;
    padding: 11px;
    margin-top: 10px;
    background: white;
    color: #285879;
    font-weight: 800;
  }

  .login-message,
  .notice {
    background: #edf6fb;
    color: #285879;
    border-radius: 10px;
    padding: 11px 13px;
  }

  .login-message {
    margin-top: 14px;
  }

  .internal-note {
    color: #8a979f;
    font-size: 11px;
    text-align: center;
    margin-top: 20px;
  }

  .hub-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 245px minmax(0, 1fr);
  }

  .sidebar {
    min-height: 100vh;
    background:
      linear-gradient(
        180deg,
        #102c43 0%,
        #173a59 52%,
        #15344f 100%
      );
    color: white;
    padding: 23px 15px 25px;
  }

  .brand-area {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 0 7px 20px;
  }

  .brand-logo {
    width: 42px;
    height: 42px;
    border-radius: 13px;
    flex: 0 0 auto;
  }

  .brand-name {
    font-weight: 900;
    font-size: 14px;
  }

  .brand-hub {
    margin-top: 2px;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.25em;
    opacity: 0.6;
  }

  .sidebar-user {
    background: rgba(255,255,255,0.075);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 13px;
    padding: 11px;
    margin-bottom: 20px;
  }

  .sidebar-user-name {
    font-size: 11px;
    font-weight: 850;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-role {
    margin-top: 3px;
    font-size: 9px;
    opacity: 0.62;
  }

  .nav-group {
    margin-top: 18px;
  }

  .nav-heading {
    padding: 0 10px 5px;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0.13em;
    opacity: 0.4;
  }

  .nav-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    border: 0;
    border-radius: 9px;
    padding: 8px 10px;
    background: transparent;
    color: rgba(255,255,255,0.82);
    font-size: 11px;
    font-weight: 750;
    text-align: left;
  }

  .nav-button:hover {
    background: rgba(255,255,255,0.06);
  }

  .nav-button.active {
    background: rgba(255,255,255,0.14);
    color: white;
  }

  .nav-button span {
    width: 17px;
    text-align: center;
    opacity: 0.8;
  }

  .main-area {
    min-width: 0;
    padding: 25px 28px 40px;
  }

  .topbar {
    min-height: 49px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
    margin-bottom: 18px;
  }

  .topbar-title {
    color: #173a59;
    font-weight: 900;
    font-size: 16px;
  }

  .topbar-subtitle {
    color: #82919a;
    font-size: 10px;
    margin-top: 2px;
  }

  .signout-button,
  .text-button {
    border: 1px solid #d2dee5;
    border-radius: 9px;
    padding: 8px 11px;
    background: white;
    color: #264e69;
    font-size: 10px;
    font-weight: 800;
  }

  .notice {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 15px;
    margin-bottom: 16px;
    font-size: 12px;
  }

  .notice button {
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 18px;
  }

  .welcome-card {
    min-height: 180px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 25px;
    padding: 28px;
    border-radius: 22px;
    color: white;
    background:
      radial-gradient(
        circle at 85% 20%,
        rgba(255,255,255,0.16),
        transparent 15rem
      ),
      linear-gradient(125deg, #173a59, #2f719e);
    box-shadow: 0 16px 35px rgba(23,58,89,0.14);
  }

  .welcome-role {
    display: inline-block;
    border-radius: 999px;
    padding: 5px 9px;
    background: rgba(255,255,255,0.14);
    font-size: 9px;
    font-weight: 850;
  }

  .welcome-card h1 {
    margin: 13px 0 4px;
    font-size: 29px;
  }

  .welcome-card p {
    margin: 0;
    color: rgba(255,255,255,0.78);
    font-size: 13px;
  }

  .welcome-action {
    white-space: nowrap;
    border: 1px solid rgba(255,255,255,0.2);
    background: rgba(255,255,255,0.12);
    color: white;
    border-radius: 10px;
    padding: 10px 13px;
    font-size: 10px;
    font-weight: 850;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0,1fr));
    gap: 13px;
    margin-top: 15px;
  }

  .stat-card,
  .panel,
  .search-card,
  .client-list-panel,
  .client-detail-panel {
    background: white;
    border: 1px solid #dfe7ec;
    box-shadow: 0 7px 22px rgba(22,48,70,0.045);
  }

  .stat-card {
    border-radius: 15px;
    padding: 16px;
  }

  .stat-label {
    color: #81909a;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .stat-value {
    margin-top: 6px;
    color: #173a59;
    font-size: 24px;
    font-weight: 950;
  }

  .stat-detail {
    margin-top: 2px;
    color: #87949c;
    font-size: 9px;
  }

  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0,1.4fr) minmax(280px,0.8fr);
    gap: 15px;
    margin-top: 15px;
  }

  .panel {
    border-radius: 17px;
    padding: 18px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .panel h2,
  .system-panel h2 {
    margin: 3px 0 10px;
    color: #173a59;
    font-size: 17px;
  }

  .quick-client-list {
    border-top: 1px solid #e8eef2;
    margin-top: 10px;
  }

  .quick-client-row {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0,1fr) auto;
    align-items: center;
    gap: 10px;
    border: 0;
    border-bottom: 1px solid #edf1f4;
    padding: 10px 2px;
    background: transparent;
    text-align: left;
  }

  .client-initial,
  .detail-avatar {
    display: grid;
    place-items: center;
    background: #e8f1f7;
    color: #285a7b;
    font-weight: 900;
  }

  .client-initial {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    font-size: 11px;
  }

  .quick-client-copy {
    min-width: 0;
  }

  .quick-client-copy strong {
    display: block;
    color: #264b64;
    font-size: 11px;
  }

  .quick-client-copy span {
    display: block;
    margin-top: 2px;
    color: #8a979f;
    font-size: 9px;
  }

  .chevron {
    color: #9eabb3;
    font-size: 19px;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #edf1f4;
    color: #5e707c;
    font-size: 10px;
  }

  .status-row strong {
    color: #2d6b58;
    text-align: right;
  }

  .status-dot {
    color: #3d9174;
    margin-right: 7px;
  }

  .commission-box {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
    background: #f3f7f9;
    border-radius: 11px;
    padding: 13px;
  }

  .commission-box span {
    color: #71818b;
    font-size: 10px;
  }

  .commission-box strong {
    color: #173a59;
    font-size: 20px;
  }

  .page-heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 20px;
    margin-bottom: 16px;
  }

  .page-heading h1 {
    margin: 4px 0 3px;
    color: #173a59;
    font-size: 28px;
  }

  .page-heading p {
    margin: 0;
    color: #7a8993;
    font-size: 11px;
  }

  .disabled-action {
    border: 0;
    border-radius: 10px;
    padding: 10px 13px;
    background: #173a59;
    color: white;
    font-size: 10px;
    font-weight: 850;
  }

  .search-card {
    display: flex;
    align-items: center;
    gap: 9px;
    border-radius: 14px;
    padding: 8px 11px;
  }

  .search-icon {
    color: #71838e;
    font-size: 20px;
  }

  .search-card input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: none;
    padding: 8px 4px;
    color: #294b62;
    background: transparent;
    font-size: 12px;
  }

  .clear-search {
    border: 0;
    background: transparent;
    color: #39759c;
    font-size: 10px;
    font-weight: 800;
  }

  .client-result-bar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 3px;
    color: #7d8c95;
    font-size: 9px;
  }

  .client-layout {
    display: grid;
    grid-template-columns: minmax(0,1.5fr) minmax(290px,0.75fr);
    gap: 14px;
    align-items: start;
  }

  .client-list-panel,
  .client-detail-panel {
    border-radius: 16px;
    overflow: hidden;
  }

  .client-list {
    max-height: 68vh;
    overflow: auto;
  }

  .client-row {
    width: 100%;
    display: grid;
    grid-template-columns:
      auto
      minmax(160px,1fr)
      minmax(160px,0.8fr)
      auto;
    align-items: center;
    gap: 11px;
    border: 0;
    border-bottom: 1px solid #edf1f4;
    padding: 11px 13px;
    background: white;
    text-align: left;
  }

  .client-row:hover,
  .client-row.selected {
    background: #f3f8fb;
  }

  .client-row.selected {
    box-shadow: inset 3px 0 0 #367ca8;
  }

  .client-row-main,
  .client-row-contact {
    min-width: 0;
  }

  .client-row-main strong {
    display: block;
    overflow: hidden;
    color: #274b63;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .client-row-main span,
  .client-row-contact span {
    display: block;
    overflow: hidden;
    color: #85939c;
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .client-row-main span {
    margin-top: 2px;
  }

  .client-row-contact span + span {
    margin-top: 3px;
  }

  .client-detail-panel {
    position: sticky;
    top: 20px;
    padding: 18px;
  }

  .detail-placeholder {
    min-height: 280px;
    display: grid;
    place-items: center;
    align-content: center;
    padding: 30px;
    text-align: center;
  }

  .detail-placeholder-icon {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    margin-bottom: 9px;
    border-radius: 14px;
    background: #edf4f8;
    color: #39759c;
  }

  .detail-placeholder h3 {
    margin: 4px 0;
    font-size: 15px;
  }

  .detail-placeholder p {
    max-width: 230px;
    margin: 0;
    color: #83919a;
    font-size: 10px;
    line-height: 1.5;
  }

  .detail-top {
    display: flex;
    align-items: center;
    gap: 13px;
    padding-bottom: 17px;
    border-bottom: 1px solid #e9eef1;
  }

  .detail-avatar {
    width: 51px;
    height: 51px;
    border-radius: 15px;
    flex: 0 0 auto;
  }

  .detail-top h2 {
    margin: 3px 0 1px;
    color: #173a59;
    font-size: 17px;
  }

  .detail-type {
    color: #7e8c95;
    font-size: 9px;
  }

  .detail-section {
    padding: 16px 0 2px;
    border-bottom: 1px solid #edf1f4;
  }

  .detail-section:last-child {
    border-bottom: 0;
  }

  .detail-section-title {
    margin-bottom: 9px;
    color: #7e8d96;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0.11em;
  }

  .detail-field {
    display: grid;
    grid-template-columns: 75px minmax(0,1fr);
    gap: 10px;
    margin-bottom: 9px;
  }

  .detail-field span {
    color: #8a979f;
    font-size: 9px;
  }

  .detail-field strong {
    overflow-wrap: anywhere;
    color: #38576a;
    font-size: 10px;
    font-weight: 750;
  }

  .client-notes {
    color: #536b7a;
    font-size: 10px;
    line-height: 1.55;
  }

  .empty-state {
    min-height: 200px;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 5px;
    padding: 25px;
    color: #81909a;
    text-align: center;
    font-size: 10px;
  }

  .empty-icon {
    font-size: 25px;
    color: #5684a2;
  }

  @media (max-width: 900px) {
    .hub-shell {
      grid-template-columns: 1fr;
    }

    .sidebar {
      min-height: auto;
      padding: 14px;
    }

    .brand-area {
      padding-bottom: 10px;
    }

    .sidebar-user {
      margin-bottom: 10px;
    }

    .nav-sections {
      display: flex;
      gap: 7px;
      overflow-x: auto;
    }

    .nav-group {
      display: contents;
    }

    .nav-heading,
    .nav-button.future {
      display: none;
    }

    .nav-button {
      width: auto;
      flex: 0 0 auto;
      padding: 8px 11px;
      background: rgba(255,255,255,0.06);
    }

    .main-area {
      padding: 17px 14px 30px;
    }

    .stats-grid {
      grid-template-columns: repeat(2, minmax(0,1fr));
    }

    .dashboard-grid,
    .client-layout {
      grid-template-columns: 1fr;
    }

    .client-detail-panel {
      position: static;
    }

    .client-list {
      max-height: none;
    }
  }

  @media (max-width: 650px) {
    .welcome-card {
      min-height: 0;
      display: block;
      padding: 23px;
    }

    .welcome-card h1 {
      font-size: 25px;
    }

    .welcome-action {
      margin-top: 18px;
    }

    .page-heading {
      align-items: flex-start;
    }

    .page-heading h1 {
      font-size: 25px;
    }

    .client-row {
      grid-template-columns: auto minmax(0,1fr) auto;
    }

    .client-row-contact {
      display: none;
    }
  }
`;
