"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type View = "dashboard" | "clients" | "manufacturers" | "quotes";
type ClientMode = "view" | "edit" | "new";
type ManufacturerMode = "view" | "edit" | "new";

type Manufacturer = {
  id: string;
  name: string;
  account_number: string | null;
  orders_email: string | null;
  phone: string | null;
  terms: string | null;
  purchasing_factor: number | null;
  default_discount_pct: number | null;
  tariff_pct: number | null;
  surcharge_pct: number | null;
  notes: string | null;
  active: boolean | null;
};

type ManufacturerForm = {
  name: string;
  account_number: string;
  orders_email: string;
  phone: string;
  terms: string;
  purchasing_factor: string;
  default_discount_pct: string;
  tariff_pct: string;
  surcharge_pct: string;
  notes: string;
  active: boolean;
};

const manufacturerColumns =
  "id,name,account_number,orders_email,phone,terms,purchasing_factor,default_discount_pct,tariff_pct,surcharge_pct,notes,active";

const blankManufacturerForm: ManufacturerForm = {
  name: "",
  account_number: "",
  orders_email: "",
  phone: "",
  terms: "",
  purchasing_factor: "",
  default_discount_pct: "",
  tariff_pct: "",
  surcharge_pct: "",
  notes: "",
  active: true,
};

type Quote = {
  id: string;
  quote_number: number;
  client_id: string;
  salesperson_user_id: string | null;
  status: string;
  quote_date: string;
  expiration_date: string | null;
  customer_po: string | null;
  notes: string | null;
  freight_amount: number;
  adjustment_amount: number;
  created_at: string;
  updated_at: string;
};

type QuoteItem = {
  id?: string;
  local_id: string;
  quote_id?: string;
  manufacturer_id: string;
  sort_order: number;
  quantity: string;
  image_url: string;
  sku: string;
  description: string;
  finish: string;
  fabric_name: string;
  grade: string;
  additional_details: string;
  msrp_at_grade: number;
  discount_pct: number;
  unit_price: number;
  purchasing_factor_snapshot: number | null;
  tariff_pct_snapshot: number;
  surcharge_pct_snapshot: number;
  expected_unit_cost: number | null;
  commissionable: boolean;
};

type QuoteForm = {
  client_id: string;
  salesperson_user_id: string;
  status: string;
  quote_date: string;
  expiration_date: string;
  customer_po: string;
  notes: string;
  freight_amount: string;
  adjustment_amount: string;
};

const quoteColumns =
  "id,quote_number,client_id,salesperson_user_id,status,quote_date,expiration_date,customer_po,notes,freight_amount,adjustment_amount,created_at,updated_at";

const quoteItemColumns =
  "id,quote_id,manufacturer_id,sort_order,quantity,image_url,sku,description,finish,fabric_name,grade,additional_details,msrp_at_grade,discount_pct,unit_price,purchasing_factor_snapshot,tariff_pct_snapshot,surcharge_pct_snapshot,expected_unit_cost,commissionable";

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
  assigned_user_id: string | null;
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

type ClientForm = {
  client_name: string;
  phone: string;
  email: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  assigned_user_id: string;
  notes: string;
  tax_exempt: boolean;
};

const clientColumns =
  "id,assigned_user_id,client_name,first_name,last_name,company_name,business_type,email,phone,city,state,zip_code,street_address,lead_status,notes,tax_exempt,active";

const blankForm: ClientForm = {
  client_name: "",
  phone: "",
  email: "",
  street_address: "",
  city: "",
  state: "",
  zip_code: "",
  assigned_user_id: "",
  notes: "",
  tax_exempt: false,
};

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

function clientToForm(client: Client): ClientForm {
  return {
    client_name: getClientName(client),
    phone: client.phone || "",
    email: client.email || "",
    street_address: client.street_address || "",
    city: client.city || "",
    state: client.state || "",
    zip_code: client.zip_code || "",
    assigned_user_id: client.assigned_user_id || "",
    notes: client.notes || "",
    tax_exempt: Boolean(client.tax_exempt),
  };
}

function manufacturerToForm(
  manufacturer: Manufacturer
): ManufacturerForm {
  return {
    name: manufacturer.name || "",
    account_number: manufacturer.account_number || "",
    orders_email: manufacturer.orders_email || "",
    phone: manufacturer.phone || "",
    terms: manufacturer.terms || "",
    purchasing_factor:
      manufacturer.purchasing_factor?.toString() || "",
    default_discount_pct:
      manufacturer.default_discount_pct?.toString() || "",
    tariff_pct: manufacturer.tariff_pct?.toString() || "",
    surcharge_pct: manufacturer.surcharge_pct?.toString() || "",
    notes: manufacturer.notes || "",
    active: manufacturer.active !== false,
  };
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysISO(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function blankQuoteItem(sortOrder = 0): QuoteItem {
  return {
    local_id: newLocalId(),
    manufacturer_id: "",
    sort_order: sortOrder,
    quantity: "1",
    image_url: "",
    sku: "",
    description: "",
    finish: "",
    fabric_name: "",
    grade: "",
    additional_details: "",
    msrp_at_grade: 0,
    discount_pct: 0,
    unit_price: 0,
    purchasing_factor_snapshot: null,
    tariff_pct_snapshot: 0,
    surcharge_pct_snapshot: 0,
    expected_unit_cost: null,
    commissionable: true,
  };
}

function calculateQuoteItem(
  item: QuoteItem,
  manufacturer?: Manufacturer
): QuoteItem {
  const msrp = numberOrZero(item.msrp_at_grade);
  const discount = numberOrZero(item.discount_pct);
  const factor =
    item.purchasing_factor_snapshot ??
    manufacturer?.purchasing_factor ??
    null;
  const tariff = numberOrZero(
    item.tariff_pct_snapshot ??
      manufacturer?.tariff_pct ??
      0
  );
  const surcharge = numberOrZero(
    item.surcharge_pct_snapshot ??
      manufacturer?.surcharge_pct ??
      0
  );

  const unitPrice = msrp * (1 - discount / 100);
  const expectedCost =
    factor == null
      ? null
      : msrp *
        Number(factor) *
        (1 + tariff / 100 + surcharge / 100);

  return {
    ...item,
    unit_price: Math.max(0, unitPrice),
    expected_unit_cost:
      expectedCost == null ? null : Math.max(0, expectedCost),
  };
}

export default function Home() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    return url && key ? createClient(url, key) : null;
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [team, setTeam] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteItemsSummary, setQuoteItemsSummary] =
    useState<Record<string, QuoteItem[]>>({});

  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");
  const [manufacturerSearch, setManufacturerSearch] = useState("");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [showArchivedQuotes, setShowArchivedQuotes] = useState(false);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientMode, setClientMode] = useState<ClientMode>("view");
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientForm, setClientForm] = useState<ClientForm>(blankForm);
  const [savingClient, setSavingClient] = useState(false);

  const [selectedManufacturer, setSelectedManufacturer] =
    useState<Manufacturer | null>(null);
  const [manufacturerMode, setManufacturerMode] =
    useState<ManufacturerMode>("view");
  const [manufacturerModalOpen, setManufacturerModalOpen] =
    useState(false);
  const [manufacturerForm, setManufacturerForm] =
    useState<ManufacturerForm>(blankManufacturerForm);
  const [savingManufacturer, setSavingManufacturer] =
    useState(false);

  const [quoteEditorOpen, setQuoteEditorOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [quoteForm, setQuoteForm] = useState<QuoteForm>({
    client_id: "",
    salesperson_user_id: "",
    status: "Draft",
    quote_date: todayISO(),
    expiration_date: plusDaysISO(30),
    customer_po: "",
    notes: "",
    freight_amount: "0",
    adjustment_amount: "0",
  });
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([
    blankQuoteItem(0),
  ]);
  const [savingQuote, setSavingQuote] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [manufacturersLoading, setManufacturersLoading] =
    useState(false);
  const [quotesLoading, setQuotesLoading] = useState(false);

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

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  const loadProfile = useCallback(async () => {
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
  }, [supabase, session?.user?.id]);

  const loadTeam = useCallback(async () => {
    if (!supabase || !session?.user?.id) {
      setTeam([]);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id,display_name,email,role,default_commission_rate,active"
      )
      .eq("active", true)
      .order("display_name", { ascending: true });

    if (error) {
      setMessage(`Team error: ${error.message}`);
      return;
    }

    setTeam((data || []) as Profile[]);
  }, [supabase, session?.user?.id]);

  const loadClients = useCallback(async () => {
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
  }, [supabase, session?.user?.id]);

  const loadManufacturers = useCallback(async () => {
    if (!supabase || !session?.user?.id) {
      setManufacturers([]);
      return;
    }

    setManufacturersLoading(true);

    const { data, error } = await supabase
      .from("manufacturers")
      .select(manufacturerColumns)
      .order("name", { ascending: true });

    if (error) {
      setMessage(`Manufacturer error: ${error.message}`);
      setManufacturersLoading(false);
      return;
    }

    setManufacturers((data || []) as Manufacturer[]);
    setManufacturersLoading(false);
  }, [supabase, session?.user?.id]);

  const loadQuotes = useCallback(async () => {
    if (!supabase || !session?.user?.id) {
      setQuotes([]);
      setQuoteItemsSummary({});
      return;
    }

    setQuotesLoading(true);

    const { data: quoteData, error: quoteError } = await supabase
      .from("quotes")
      .select(quoteColumns)
      .order("quote_number", { ascending: false });

    if (quoteError) {
      setMessage(`Quote error: ${quoteError.message}`);
      setQuotesLoading(false);
      return;
    }

    const loadedQuotes = (quoteData || []) as Quote[];
    setQuotes(loadedQuotes);

    if (loadedQuotes.length === 0) {
      setQuoteItemsSummary({});
      setQuotesLoading(false);
      return;
    }

    const { data: itemData, error: itemError } = await supabase
      .from("quote_items")
      .select(quoteItemColumns)
      .in(
        "quote_id",
        loadedQuotes.map((quote) => quote.id)
      )
      .order("sort_order", { ascending: true });

    if (itemError) {
      setMessage(`Quote item error: ${itemError.message}`);
      setQuotesLoading(false);
      return;
    }

    const grouped: Record<string, QuoteItem[]> = {};

    for (const rawItem of itemData || []) {
      const item = rawItem as Omit<QuoteItem, "local_id"> & {
        local_id?: string;
      };
      const quoteId = item.quote_id || "";
      if (!grouped[quoteId]) grouped[quoteId] = [];
      grouped[quoteId].push({
        ...item,
        local_id: item.id || newLocalId(),
        manufacturer_id: item.manufacturer_id || "",
        image_url: item.image_url || "",
        sku: item.sku || "",
        description: item.description || "",
        finish: item.finish || "",
        fabric_name: item.fabric_name || "",
        grade: item.grade || "",
        additional_details: item.additional_details || "",
        msrp_at_grade: numberOrZero(item.msrp_at_grade),
        discount_pct: numberOrZero(item.discount_pct),
        unit_price: numberOrZero(item.unit_price),
        purchasing_factor_snapshot:
          item.purchasing_factor_snapshot == null
            ? null
            : Number(item.purchasing_factor_snapshot),
        tariff_pct_snapshot: numberOrZero(
          item.tariff_pct_snapshot
        ),
        surcharge_pct_snapshot: numberOrZero(
          item.surcharge_pct_snapshot
        ),
        expected_unit_cost:
          item.expected_unit_cost == null
            ? null
            : Number(item.expected_unit_cost),
        quantity: String(numberOrZero(item.quantity) || 1),
        sort_order: numberOrZero(item.sort_order),
        commissionable: item.commissionable !== false,
      });
    }

    setQuoteItemsSummary(grouped);
    setQuotesLoading(false);
  }, [supabase, session?.user?.id]);

  useEffect(() => {
    loadProfile();
    loadTeam();
    loadClients();
    loadManufacturers();
    loadQuotes();
  }, [
    loadProfile,
    loadTeam,
    loadClients,
    loadManufacturers,
    loadQuotes,
  ]);

  const filteredClients = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return clients;

    return clients.filter((client) => {
      const salesperson =
        team.find((person) => person.id === client.assigned_user_id)
          ?.display_name || "";

      const searchable = [
        getClientName(client),
        client.email,
        client.phone,
        client.city,
        client.state,
        client.zip_code,
        client.street_address,
        salesperson,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(term);
    });
  }, [clients, search, team]);

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

  const filteredManufacturers = useMemo(() => {
    const term = manufacturerSearch.trim().toLowerCase();

    if (!term) return manufacturers;

    return manufacturers.filter((manufacturer) =>
      [
        manufacturer.name,
        manufacturer.account_number,
        manufacturer.orders_email,
        manufacturer.phone,
        manufacturer.terms,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [manufacturers, manufacturerSearch]);

  const manufacturerStats = useMemo(() => {
    const active = manufacturers.filter(
      (manufacturer) => manufacturer.active !== false
    ).length;

    const withTariff = manufacturers.filter(
      (manufacturer) => Number(manufacturer.tariff_pct || 0) > 0
    ).length;

    return {
      total: manufacturers.length,
      active,
      withTariff,
    };
  }, [manufacturers]);

  const filteredQuotes = useMemo(() => {
    const term = quoteSearch.trim().toLowerCase();
    const visibleQuotes = quotes.filter((quote) =>
      showArchivedQuotes
        ? quote.status === "Archived"
        : quote.status !== "Archived"
    );

    if (!term) return visibleQuotes;

    return visibleQuotes.filter((quote) => {
      const client = clients.find(
        (client) => client.id === quote.client_id
      );
      const salesperson = team.find(
        (person) => person.id === quote.salesperson_user_id
      );

      return [
        quote.quote_number.toString(),
        quote.status,
        quote.customer_po,
        client ? getClientName(client) : "",
        salesperson?.display_name || "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [
    quotes,
    quoteSearch,
    clients,
    team,
    showArchivedQuotes,
  ]);

  const quoteStats = useMemo(() => {
    const activeQuotes = quotes.filter(
      (quote) => quote.status !== "Archived"
    );
    const archived = quotes.filter(
      (quote) => quote.status === "Archived"
    ).length;
    const drafts = activeQuotes.filter(
      (quote) => quote.status === "Draft"
    ).length;

    const totalValue = activeQuotes.reduce((sum, quote) => {
      const items = quoteItemsSummary[quote.id] || [];
      const merchandise = items.reduce(
        (itemSum, item) =>
          itemSum +
          numberOrZero(item.quantity) *
            numberOrZero(item.unit_price),
        0
      );

      return (
        sum +
        merchandise +
        numberOrZero(quote.freight_amount) +
        numberOrZero(quote.adjustment_amount)
      );
    }, 0);

    return {
      total: activeQuotes.length,
      drafts,
      archived,
      totalValue,
    };
  }, [quotes, quoteItemsSummary]);

  function salespersonName(id: string | null | undefined) {
    if (!id) return "Unassigned";
    return team.find((person) => person.id === id)?.display_name || "Assigned";
  }

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
    setTeam([]);
    setClients([]);
    setManufacturers([]);
    setQuotes([]);
    setQuoteItemsSummary({});
    setSelectedClient(null);
    setSelectedManufacturer(null);
    setSelectedQuote(null);
    setSearch("");
    setManufacturerSearch("");
    setQuoteSearch("");
    setView("dashboard");
    setMessage("");
  }

  function openClient(client: Client) {
    setSelectedClient(client);
    setClientForm(clientToForm(client));
    setClientMode("view");
    setClientModalOpen(true);
  }

  function openNewClient() {
    setSelectedClient(null);
    setClientForm({
      ...blankForm,
      assigned_user_id: profile?.id || "",
    });
    setClientMode("new");
    setClientModalOpen(true);
  }

  function beginEdit() {
    if (!selectedClient) return;
    setClientForm(clientToForm(selectedClient));
    setClientMode("edit");
  }

  function closeClientModal() {
    if (savingClient) return;
    setClientModalOpen(false);
    setSelectedClient(null);
    setClientMode("view");
  }

  function updateForm<K extends keyof ClientForm>(
    field: K,
    value: ClientForm[K]
  ) {
    setClientForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveClient() {
    if (!supabase) return;

    const cleanName = clientForm.client_name.trim();

    if (!cleanName) {
      setMessage("Client name is required.");
      return;
    }

    setSavingClient(true);
    setMessage("");

    const payload = {
      client_name: cleanName,
      phone: clientForm.phone.trim() || null,
      email: clientForm.email.trim() || null,
      street_address: clientForm.street_address.trim() || null,
      city: clientForm.city.trim() || null,
      state: clientForm.state.trim().toUpperCase() || null,
      zip_code: clientForm.zip_code.trim() || null,
      assigned_user_id: clientForm.assigned_user_id || null,
      notes: clientForm.notes.trim() || null,
      tax_exempt: clientForm.tax_exempt,
      active: true,
      updated_at: new Date().toISOString(),
    };

    if (clientMode === "new") {
      const { data, error } = await supabase
        .from("clients")
        .insert(payload)
        .select(clientColumns)
        .single();

      if (error) {
        setMessage(`Could not create client: ${error.message}`);
        setSavingClient(false);
        return;
      }

      setSelectedClient(data as Client);
      setClientMode("view");
      setClientForm(clientToForm(data as Client));
      setMessage(`${cleanName} was added.`);
    } else if (clientMode === "edit" && selectedClient) {
      const { data, error } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", selectedClient.id)
        .select(clientColumns)
        .single();

      if (error) {
        setMessage(`Could not save client: ${error.message}`);
        setSavingClient(false);
        return;
      }

      setSelectedClient(data as Client);
      setClientMode("view");
      setClientForm(clientToForm(data as Client));
      setMessage(`${cleanName} was updated.`);
    }

    await loadClients();
    setSavingClient(false);
  }

  async function deleteClient() {
    if (!supabase || !selectedClient) return;

    const name = getClientName(selectedClient);
    const confirmed = window.confirm(
      `Delete ${name}? This cannot be undone.`
    );

    if (!confirmed) return;

    setSavingClient(true);
    setMessage("");

    const { error } = await supabase
      .from("clients")
      .delete()
      .eq("id", selectedClient.id);

    if (error) {
      setMessage(`Could not delete client: ${error.message}`);
      setSavingClient(false);
      return;
    }

    setClientModalOpen(false);
    setSelectedClient(null);
    await loadClients();
    setSavingClient(false);
    setMessage(`${name} was deleted.`);
  }

  function openManufacturer(manufacturer: Manufacturer) {
    setSelectedManufacturer(manufacturer);
    setManufacturerForm(manufacturerToForm(manufacturer));
    setManufacturerMode("view");
    setManufacturerModalOpen(true);
  }

  function openNewManufacturer() {
    setSelectedManufacturer(null);
    setManufacturerForm(blankManufacturerForm);
    setManufacturerMode("new");
    setManufacturerModalOpen(true);
  }

  function beginManufacturerEdit() {
    if (!selectedManufacturer) return;
    setManufacturerForm(
      manufacturerToForm(selectedManufacturer)
    );
    setManufacturerMode("edit");
  }

  function closeManufacturerModal() {
    if (savingManufacturer) return;
    setManufacturerModalOpen(false);
    setSelectedManufacturer(null);
    setManufacturerMode("view");
  }

  function updateManufacturerForm<
    K extends keyof ManufacturerForm
  >(field: K, value: ManufacturerForm[K]) {
    setManufacturerForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveManufacturer() {
    if (!supabase) return;

    const name = manufacturerForm.name.trim();

    if (!name) {
      setMessage("Manufacturer name is required.");
      return;
    }

    setSavingManufacturer(true);
    setMessage("");

    const numericOrNull = (value: string) => {
      if (!value.trim()) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const payload = {
      name,
      account_number:
        manufacturerForm.account_number.trim() || null,
      orders_email:
        manufacturerForm.orders_email.trim() || null,
      phone: manufacturerForm.phone.trim() || null,
      terms: manufacturerForm.terms.trim() || null,
      purchasing_factor: numericOrNull(
        manufacturerForm.purchasing_factor
      ),
      default_discount_pct: numericOrNull(
        manufacturerForm.default_discount_pct
      ),
      tariff_pct: numericOrNull(
        manufacturerForm.tariff_pct
      ),
      surcharge_pct: numericOrNull(
        manufacturerForm.surcharge_pct
      ),
      notes: manufacturerForm.notes.trim() || null,
      active: manufacturerForm.active,
      updated_at: new Date().toISOString(),
    };

    if (manufacturerMode === "new") {
      const { data, error } = await supabase
        .from("manufacturers")
        .insert(payload)
        .select(manufacturerColumns)
        .single();

      if (error) {
        setMessage(
          `Could not create manufacturer: ${error.message}`
        );
        setSavingManufacturer(false);
        return;
      }

      setSelectedManufacturer(data as Manufacturer);
      setManufacturerForm(
        manufacturerToForm(data as Manufacturer)
      );
      setManufacturerMode("view");
      setMessage(`${name} was added.`);
    } else if (
      manufacturerMode === "edit" &&
      selectedManufacturer
    ) {
      const { data, error } = await supabase
        .from("manufacturers")
        .update(payload)
        .eq("id", selectedManufacturer.id)
        .select(manufacturerColumns)
        .single();

      if (error) {
        setMessage(
          `Could not save manufacturer: ${error.message}`
        );
        setSavingManufacturer(false);
        return;
      }

      setSelectedManufacturer(data as Manufacturer);
      setManufacturerForm(
        manufacturerToForm(data as Manufacturer)
      );
      setManufacturerMode("view");
      setMessage(`${name} was updated.`);
    }

    await loadManufacturers();
    setSavingManufacturer(false);
  }


  function clientNameById(id: string) {
    const client = clients.find((client) => client.id === id);
    return client ? getClientName(client) : "Unknown client";
  }

  function resetQuoteEditor() {
    setSelectedQuote(null);
    setQuoteForm({
      client_id: "",
      salesperson_user_id: profile?.id || "",
      status: "Draft",
      quote_date: todayISO(),
      expiration_date: plusDaysISO(30),
      customer_po: "",
      notes: "",
      freight_amount: "0",
      adjustment_amount: "0",
    });
    setQuoteItems([blankQuoteItem(0)]);
  }

  function openNewQuote() {
    resetQuoteEditor();
    setQuoteEditorOpen(true);
    setMessage("");
  }

  async function openQuote(quote: Quote) {
    if (!supabase) return;

    setSelectedQuote(quote);
    setQuoteForm({
      client_id: quote.client_id,
      salesperson_user_id: quote.salesperson_user_id || "",
      status: quote.status || "Draft",
      quote_date: quote.quote_date || todayISO(),
      expiration_date: quote.expiration_date || "",
      customer_po: quote.customer_po || "",
      notes: quote.notes || "",
      freight_amount: numberOrZero(
        quote.freight_amount
      ).toString(),
      adjustment_amount: numberOrZero(
        quote.adjustment_amount
      ).toString(),
    });

    setQuoteEditorOpen(true);
    setMessage("");

    const { data, error } = await supabase
      .from("quote_items")
      .select(quoteItemColumns)
      .eq("quote_id", quote.id)
      .order("sort_order", { ascending: true });

    if (error) {
      setMessage(`Could not load quote items: ${error.message}`);
      return;
    }

    const loadedItems = (data || []).map((rawItem) => {
      const item = rawItem as Omit<QuoteItem, "local_id">;
      return {
        ...item,
        local_id: item.id || newLocalId(),
        manufacturer_id: item.manufacturer_id || "",
        image_url: item.image_url || "",
        sku: item.sku || "",
        description: item.description || "",
        finish: item.finish || "",
        fabric_name: item.fabric_name || "",
        grade: item.grade || "",
        additional_details: item.additional_details || "",
        quantity: String(numberOrZero(item.quantity) || 1),
        sort_order: numberOrZero(item.sort_order),
        msrp_at_grade: numberOrZero(item.msrp_at_grade),
        discount_pct: numberOrZero(item.discount_pct),
        unit_price: numberOrZero(item.unit_price),
        purchasing_factor_snapshot:
          item.purchasing_factor_snapshot == null
            ? null
            : Number(item.purchasing_factor_snapshot),
        tariff_pct_snapshot: numberOrZero(
          item.tariff_pct_snapshot
        ),
        surcharge_pct_snapshot: numberOrZero(
          item.surcharge_pct_snapshot
        ),
        expected_unit_cost:
          item.expected_unit_cost == null
            ? null
            : Number(item.expected_unit_cost),
        commissionable: item.commissionable !== false,
      } as QuoteItem;
    });

    setQuoteItems(
      loadedItems.length > 0
        ? loadedItems
        : [blankQuoteItem(0)]
    );
  }

  function closeQuoteEditor() {
    if (savingQuote) return;
    setQuoteEditorOpen(false);
    setSelectedQuote(null);
  }

  function updateQuoteForm<K extends keyof QuoteForm>(
    field: K,
    value: QuoteForm[K]
  ) {
    setQuoteForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function addQuoteItem() {
    setQuoteItems((current) => [
      ...current,
      blankQuoteItem(current.length),
    ]);
  }

  function removeQuoteItem(localId: string) {
    setQuoteItems((current) => {
      const next = current.filter(
        (item) => item.local_id !== localId
      );
      return next.length > 0 ? next : [blankQuoteItem(0)];
    });
  }

  function updateQuoteItem(
    localId: string,
    field: keyof QuoteItem,
    value: string | number | boolean | null
  ) {
    setQuoteItems((current) =>
      current.map((existing) => {
        if (existing.local_id !== localId) return existing;

        let next = {
          ...existing,
          [field]: value,
        } as QuoteItem;

        if (field === "manufacturer_id") {
          const manufacturer = manufacturers.find(
            (manufacturer) => manufacturer.id === value
          );

          next = {
            ...next,
            manufacturer_id: String(value || ""),
            discount_pct: numberOrZero(
              manufacturer?.default_discount_pct
            ),
            purchasing_factor_snapshot:
              manufacturer?.purchasing_factor == null
                ? null
                : Number(manufacturer.purchasing_factor),
            tariff_pct_snapshot: numberOrZero(
              manufacturer?.tariff_pct
            ),
            surcharge_pct_snapshot: numberOrZero(
              manufacturer?.surcharge_pct
            ),
          };

          return calculateQuoteItem(next, manufacturer);
        }

        if (
          field === "msrp_at_grade" ||
          field === "discount_pct" ||
          field === "purchasing_factor_snapshot" ||
          field === "tariff_pct_snapshot" ||
          field === "surcharge_pct_snapshot"
        ) {
          const manufacturer = manufacturers.find(
            (manufacturer) =>
              manufacturer.id === next.manufacturer_id
          );
          return calculateQuoteItem(next, manufacturer);
        }

        return next;
      })
    );
  }

  const quoteEditorTotals = useMemo(() => {
    const merchandise = quoteItems.reduce(
      (sum, item) =>
        sum +
        numberOrZero(item.quantity) *
          numberOrZero(item.unit_price),
      0
    );

    const expectedCost = quoteItems.reduce(
      (sum, item) =>
        sum +
        numberOrZero(item.quantity) *
          numberOrZero(item.expected_unit_cost),
      0
    );

    const freight = numberOrZero(quoteForm.freight_amount);
    const adjustment = numberOrZero(
      quoteForm.adjustment_amount
    );
    const total = merchandise + freight + adjustment;
    const marginDollar = merchandise - expectedCost;
    const marginPct =
      merchandise > 0
        ? (marginDollar / merchandise) * 100
        : 0;

    return {
      merchandise,
      expectedCost,
      freight,
      adjustment,
      total,
      marginDollar,
      marginPct,
    };
  }, [quoteItems, quoteForm.freight_amount, quoteForm.adjustment_amount]);

  function pdfEscape(value: string) {
    return value
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function wrapPdfText(value: string, maxChars = 88) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];

    const lines: string[] = [];
    let current = words[0];

    for (const word of words.slice(1)) {
      if (`${current} ${word}`.length <= maxChars) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }

    lines.push(current);
    return lines;
  }

  function buildSimplePdf(
    documentLines: Array<{
      text: string;
      size?: number;
      bold?: boolean;
      gapAfter?: number;
    }>
  ) {
    const pages: string[][] = [[]];
    let pageIndex = 0;
    let y = 748;

    for (const line of documentLines) {
      const size = line.size || 10;
      const step = size + 5 + (line.gapAfter || 0);

      if (y - step < 52) {
        pages.push([]);
        pageIndex += 1;
        y = 748;
      }

      const font = line.bold ? "F2" : "F1";
      pages[pageIndex].push(
        `BT /${font} ${size} Tf 50 ${y} Td (${pdfEscape(
          line.text
        )}) Tj ET`
      );
      y -= step;
    }

    const objects: string[] = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[3] =
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    objects[4] =
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

    const pageIds: number[] = [];
    let nextId = 5;

    pages.forEach((commands) => {
      const pageId = nextId++;
      const contentId = nextId++;
      pageIds.push(pageId);

      const stream = commands.join("\n");
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`;
    });

    objects[2] =
      `<< /Type /Pages /Count ${pageIds.length} /Kids [` +
      pageIds.map((id) => `${id} 0 R`).join(" ") +
      "] >>";

    let pdf = "%PDF-1.4\n%DPHUB\n";
    const offsets: number[] = [0];

    for (let id = 1; id < objects.length; id += 1) {
      offsets[id] = pdf.length;
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length}\n`;
    pdf += "0000000000 65535 f \n";

    for (let id = 1; id < objects.length; id += 1) {
      pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }

    pdf +=
      `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF`;

    return pdf;
  }

  function downloadQuotePdf() {
    if (!selectedQuote) {
      setMessage("Save the quote before downloading its PDF.");
      return;
    }

    const client = clients.find(
      (entry) => entry.id === quoteForm.client_id
    );
    const salesperson = team.find(
      (entry) => entry.id === quoteForm.salesperson_user_id
    );

    const lines: Array<{
      text: string;
      size?: number;
      bold?: boolean;
      gapAfter?: number;
    }> = [
      {
        text: "DESIGNER'S PATIO",
        size: 18,
        bold: true,
      },
      {
        text: "Customer Quote",
        size: 12,
        gapAfter: 5,
      },
      {
        text: `Quote #${selectedQuote.quote_number}`,
        size: 13,
        bold: true,
      },
      {
        text: `Quote Date: ${quoteForm.quote_date || ""}   Expires: ${
          quoteForm.expiration_date || ""
        }`,
      },
      {
        text: `Status: ${quoteForm.status || "Draft"}`,
        gapAfter: 6,
      },
      {
        text: `Client: ${
          client ? getClientName(client) : "Unknown client"
        }`,
        bold: true,
      },
    ];

    if (client?.street_address) {
      lines.push({ text: client.street_address });
    }
    if (client) {
      const cityLine = [client.city, client.state, client.zip_code]
        .filter(Boolean)
        .join(" ");
      if (cityLine) lines.push({ text: cityLine });
      if (client.phone) lines.push({ text: `Phone: ${client.phone}` });
      if (client.email) lines.push({ text: `Email: ${client.email}` });
    }

    lines.push({
      text: `Sales Specialist: ${
        salesperson?.display_name || "Unassigned"
      }${salesperson?.email ? ` | ${salesperson.email}` : ""}`,
      gapAfter: 8,
    });

    lines.push({ text: "ITEMS", size: 11, bold: true });

    quoteItems.forEach((item, index) => {
      const manufacturer = manufacturers.find(
        (entry) => entry.id === item.manufacturer_id
      );
      const qty = Math.max(1, numberOrZero(item.quantity));
      const ext = qty * numberOrZero(item.unit_price);

      lines.push({
        text: `${index + 1}. Qty ${qty} | ${
          manufacturer?.name || "Manufacturer not selected"
        } | ${item.sku || "No SKU"}`,
        bold: true,
      });

      wrapPdfText(item.description || "No description", 82).forEach(
        (wrapped) => lines.push({ text: wrapped })
      );

      const detailBits = [
        item.finish ? `Finish: ${item.finish}` : "",
        item.fabric_name ? `Fabric: ${item.fabric_name}` : "",
        item.grade ? `Grade: ${item.grade}` : "",
      ].filter(Boolean);

      if (detailBits.length) {
        lines.push({ text: detailBits.join(" | ") });
      }

      lines.push({
        text:
          `MSRP @ Grade: ${money(numberOrZero(item.msrp_at_grade))} | ` +
          `Discount: ${numberOrZero(item.discount_pct)}% | ` +
          `Unit: ${money(numberOrZero(item.unit_price))} | ` +
          `Extended: ${money(ext)}`,
        gapAfter: 3,
      });

      if (item.additional_details) {
        wrapPdfText(
          `Details: ${item.additional_details}`,
          82
        ).forEach((wrapped) => lines.push({ text: wrapped }));
      }
    });

    lines.push({ text: "", gapAfter: 4 });
    lines.push({
      text: `Merchandise: ${money(quoteEditorTotals.merchandise)}`,
      bold: true,
    });
    lines.push({ text: `Freight: ${money(quoteEditorTotals.freight)}` });
    lines.push({
      text: `Adjustment: ${money(quoteEditorTotals.adjustment)}`,
    });
    lines.push({
      text: `QUOTE TOTAL: ${money(quoteEditorTotals.total)}`,
      size: 13,
      bold: true,
      gapAfter: 7,
    });

    if (quoteForm.notes.trim()) {
      lines.push({ text: "NOTES", size: 10, bold: true });
      wrapPdfText(quoteForm.notes, 84).forEach((wrapped) =>
        lines.push({ text: wrapped })
      );
    }

    const pdf = buildSimplePdf(lines);
    const blob = new Blob([pdf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Designers-Patio-Quote-${selectedQuote.quote_number}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function toggleQuoteArchive() {
    if (!supabase || !selectedQuote) return;

    const isArchived = selectedQuote.status === "Archived";
    const nextStatus = isArchived ? "Draft" : "Archived";

    setSavingQuote(true);
    setMessage("");

    const { data, error } = await supabase
      .from("quotes")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedQuote.id)
      .select(quoteColumns)
      .single();

    if (error) {
      setMessage(`Could not update quote archive: ${error.message}`);
      setSavingQuote(false);
      return;
    }

    setSelectedQuote(data as Quote);
    setQuoteForm((current) => ({
      ...current,
      status: nextStatus,
    }));
    setShowArchivedQuotes(!isArchived);
    await loadQuotes();
    setSavingQuote(false);
    setMessage(
      isArchived
        ? `Quote #${selectedQuote.quote_number} was restored to Draft.`
        : `Quote #${selectedQuote.quote_number} was archived.`
    );
  }

  async function saveQuote() {
    if (!supabase) return;

    if (!quoteForm.client_id) {
      setMessage("Choose a client before saving the quote.");
      return;
    }

    setSavingQuote(true);
    setMessage("");

    const headerPayload = {
      client_id: quoteForm.client_id,
      salesperson_user_id:
        quoteForm.salesperson_user_id || profile?.id || null,
      status: quoteForm.status || "Draft",
      quote_date: quoteForm.quote_date || todayISO(),
      expiration_date: quoteForm.expiration_date || null,
      customer_po: quoteForm.customer_po.trim() || null,
      notes: quoteForm.notes.trim() || null,
      freight_amount: numberOrZero(
        quoteForm.freight_amount
      ),
      adjustment_amount: numberOrZero(
        quoteForm.adjustment_amount
      ),
      updated_at: new Date().toISOString(),
    };

    let quoteId = selectedQuote?.id || "";
    let savedQuote: Quote | null = selectedQuote;

    if (!selectedQuote) {
      const { data, error } = await supabase
        .from("quotes")
        .insert(headerPayload)
        .select(quoteColumns)
        .single();

      if (error) {
        setMessage(`Could not create quote: ${error.message}`);
        setSavingQuote(false);
        return;
      }

      savedQuote = data as Quote;
      quoteId = savedQuote.id;
      setSelectedQuote(savedQuote);
    } else {
      const { data, error } = await supabase
        .from("quotes")
        .update(headerPayload)
        .eq("id", selectedQuote.id)
        .select(quoteColumns)
        .single();

      if (error) {
        setMessage(`Could not save quote: ${error.message}`);
        setSavingQuote(false);
        return;
      }

      savedQuote = data as Quote;
      setSelectedQuote(savedQuote);
    }

    const { error: deleteError } = await supabase
      .from("quote_items")
      .delete()
      .eq("quote_id", quoteId);

    if (deleteError) {
      setMessage(
        `Quote saved, but line items could not refresh: ${deleteError.message}`
      );
      setSavingQuote(false);
      return;
    }

    const itemPayloads = quoteItems
      .filter(
        (item) =>
          item.manufacturer_id ||
          item.sku.trim() ||
          item.description.trim() ||
          numberOrZero(item.msrp_at_grade) > 0
      )
      .map((item, index) => ({
        quote_id: quoteId,
        manufacturer_id: item.manufacturer_id || null,
        sort_order: index,
        quantity: Math.max(1, numberOrZero(item.quantity)),
        image_url: item.image_url.trim() || null,
        sku: item.sku.trim() || null,
        description: item.description.trim() || null,
        finish: item.finish.trim() || null,
        fabric_name: item.fabric_name.trim() || null,
        grade: item.grade.trim() || null,
        additional_details:
          item.additional_details.trim() || null,
        msrp_at_grade: numberOrZero(item.msrp_at_grade),
        discount_pct: numberOrZero(item.discount_pct),
        unit_price: numberOrZero(item.unit_price),
        purchasing_factor_snapshot:
          item.purchasing_factor_snapshot,
        tariff_pct_snapshot: numberOrZero(
          item.tariff_pct_snapshot
        ),
        surcharge_pct_snapshot: numberOrZero(
          item.surcharge_pct_snapshot
        ),
        expected_unit_cost: item.expected_unit_cost,
        commissionable: item.commissionable,
        updated_at: new Date().toISOString(),
      }));

    if (itemPayloads.length > 0) {
      const { error: itemError } = await supabase
        .from("quote_items")
        .insert(itemPayloads);

      if (itemError) {
        setMessage(
          `Quote header saved, but line items failed: ${itemError.message}`
        );
        setSavingQuote(false);
        return;
      }
    }

    await loadQuotes();
    setSavingQuote(false);
    setMessage(
      `Quote #${savedQuote?.quote_number || ""} saved as ${
        savedQuote?.status || "Draft"
      }.`
    );
  }

  async function deleteQuote() {
    if (!supabase || !selectedQuote) return;

    const confirmed = window.confirm(
      `Delete Quote #${selectedQuote.quote_number}? This cannot be undone.`
    );

    if (!confirmed) return;

    setSavingQuote(true);

    const { error } = await supabase
      .from("quotes")
      .delete()
      .eq("id", selectedQuote.id);

    if (error) {
      setMessage(`Could not delete quote: ${error.message}`);
      setSavingQuote(false);
      return;
    }

    setQuoteEditorOpen(false);
    setSelectedQuote(null);
    setSavingQuote(false);
    await loadQuotes();
    setMessage(`Quote #${selectedQuote.quote_number} was deleted.`);
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
                className={`nav-button ${
                  view === "quotes" ? "active" : ""
                }`}
                onClick={() => {
                  setView("quotes");
                  setMessage("");
                }}
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

              {[
                "AI Finder",
                "Catalogs",
                "Price Lists",
                "Inventory",
              ].map((label) => (
                <button
                  key={label}
                  className="nav-button future"
                  onClick={() => openFutureSection(label)}
                >
                  <span>◇</span>
                  {label}
                </button>
              ))}

              <button
                className={`nav-button ${
                  view === "manufacturers" ? "active" : ""
                }`}
                onClick={() => {
                  setView("manufacturers");
                  setMessage("");
                }}
              >
                <span>◇</span>
                Manufacturers
              </button>
            </div>

            <div className="nav-group">
              <div className="nav-heading">OPERATIONS</div>

              {[
                "Purchase Orders",
                "Acknowledgements",
                "Accounting",
                "Reports",
              ].map((label) => (
                <button
                  key={label}
                  className="nav-button future"
                  onClick={() => openFutureSection(label)}
                >
                  <span>▥</span>
                  {label}
                </button>
              ))}
            </div>

            <div className="nav-group">
              <div className="nav-heading">ADMIN</div>

              {["Team", "Settings"].map((label) => (
                <button
                  key={label}
                  className="nav-button future"
                  onClick={() => openFutureSection(label)}
                >
                  <span>⚙</span>
                  {label}
                </button>
              ))}
            </div>
          </nav>
        </aside>

        <main className="main-area">
          <header className="topbar">
            <div>
              <div className="topbar-title">
                {view === "dashboard"
                  ? "Dashboard"
                  : view === "clients"
                  ? "Clients"
                  : view === "manufacturers"
                  ? "Manufacturers"
                  : "Quotes"}
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
              <span>{message}</span>
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
                            setView("clients");
                            openClient(client);
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
                  className="new-client-button"
                  onClick={openNewClient}
                >
                  + New Client
                </button>
              </div>

              <div className="search-card">
                <div className="search-icon">⌕</div>

                <input
                  type="search"
                  placeholder="Search name, city, state, phone, email, address or salesperson..."
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

                {search && <span>matching “{search}”</span>}
              </div>

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
                      Try a different name, phone number, city,
                      salesperson or email.
                    </span>
                  </div>
                ) : (
                  <div className="client-list">
                    {filteredClients.map((client) => (
                      <button
                        key={client.id}
                        className="client-row"
                        onClick={() => openClient(client)}
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
                          <span>{client.phone || "No phone"}</span>
                          <span>{client.email || "No email"}</span>
                        </div>

                        <div className="client-row-sales">
                          <span>Salesperson</span>
                          <strong>
                            {salespersonName(client.assigned_user_id)}
                          </strong>
                        </div>

                        <div className="chevron">›</div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </section>
          )}

          {view === "manufacturers" && (
            <section>
              <div className="page-heading">
                <div>
                  <div className="section-eyebrow">
                    VENDOR PRICING & PURCHASING
                  </div>
                  <h1>Manufacturers</h1>
                  <p>
                    Pricing rules here will drive quotes, expected
                    costs and purchase orders.
                  </p>
                </div>

                <button
                  className="new-client-button"
                  onClick={openNewManufacturer}
                >
                  + New Manufacturer
                </button>
              </div>

              <div className="manufacturer-stats">
                <MiniStat
                  label="MANUFACTURERS"
                  value={manufacturerStats.total.toString()}
                />
                <MiniStat
                  label="ACTIVE"
                  value={manufacturerStats.active.toString()}
                />
                <MiniStat
                  label="WITH TARIFF"
                  value={manufacturerStats.withTariff.toString()}
                />
              </div>

              <div className="search-card">
                <div className="search-icon">⌕</div>

                <input
                  type="search"
                  placeholder="Search manufacturer, account number, email, phone or terms..."
                  value={manufacturerSearch}
                  onChange={(e) =>
                    setManufacturerSearch(e.target.value)
                  }
                />

                {manufacturerSearch && (
                  <button
                    className="clear-search"
                    onClick={() => setManufacturerSearch("")}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="client-result-bar">
                <span>
                  {filteredManufacturers.length}{" "}
                  {filteredManufacturers.length === 1
                    ? "manufacturer"
                    : "manufacturers"}
                </span>
              </div>

              <section className="client-list-panel">
                {manufacturersLoading ? (
                  <div className="empty-state">
                    Loading manufacturers...
                  </div>
                ) : filteredManufacturers.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">◇</div>
                    <strong>No manufacturers yet</strong>
                    <span>
                      Add your first manufacturer to start building
                      pricing rules for quotes and purchase orders.
                    </span>
                  </div>
                ) : (
                  <div className="client-list">
                    {filteredManufacturers.map((manufacturer) => (
                      <button
                        key={manufacturer.id}
                        className="manufacturer-row"
                        onClick={() =>
                          openManufacturer(manufacturer)
                        }
                      >
                        <div className="manufacturer-mark">
                          {manufacturer.name
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <div className="manufacturer-main">
                          <strong>{manufacturer.name}</strong>
                          <span>
                            {manufacturer.account_number
                              ? `Acct ${manufacturer.account_number}`
                              : "No account number"}
                          </span>
                        </div>

                        <ManufacturerMetric
                          label="Factor"
                          value={
                            manufacturer.purchasing_factor != null
                              ? manufacturer.purchasing_factor.toString()
                              : "—"
                          }
                        />

                        <ManufacturerMetric
                          label="Default Disc."
                          value={
                            manufacturer.default_discount_pct != null
                              ? `${manufacturer.default_discount_pct}%`
                              : "—"
                          }
                        />

                        <ManufacturerMetric
                          label="Tariff"
                          value={
                            manufacturer.tariff_pct != null
                              ? `${manufacturer.tariff_pct}%`
                              : "—"
                          }
                        />

                        <ManufacturerMetric
                          label="Surcharge"
                          value={
                            manufacturer.surcharge_pct != null
                              ? `${manufacturer.surcharge_pct}%`
                              : "—"
                          }
                        />

                        <div className="chevron">›</div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </section>
          )}

          {view === "quotes" && (
            <section>
              <div className="page-heading">
                <div>
                  <div className="section-eyebrow">
                    SALES QUOTING
                  </div>
                  <h1>Quotes</h1>
                  <p>
                    Build, save and reopen customer quotes using live
                    client and manufacturer pricing data.
                  </p>
                </div>

                <button
                  className="new-client-button"
                  onClick={openNewQuote}
                >
                  + New Quote
                </button>
              </div>

              <div className="quote-stat-grid">
                <MiniStat
                  label="ACTIVE QUOTES"
                  value={quoteStats.total.toString()}
                />
                <MiniStat
                  label="DRAFTS"
                  value={quoteStats.drafts.toString()}
                />
                <MiniStat
                  label="ARCHIVED"
                  value={quoteStats.archived.toString()}
                />
                <MiniStat
                  label="OPEN VALUE"
                  value={money(quoteStats.totalValue)}
                />
              </div>

              <div className="quote-archive-tabs">
                <button
                  className={!showArchivedQuotes ? "active" : ""}
                  onClick={() => setShowArchivedQuotes(false)}
                >
                  Active Quotes
                </button>
                <button
                  className={showArchivedQuotes ? "active" : ""}
                  onClick={() => setShowArchivedQuotes(true)}
                >
                  Archive ({quoteStats.archived})
                </button>
              </div>

              <div className="search-card">
                <div className="search-icon">⌕</div>
                <input
                  type="search"
                  placeholder="Search quote #, client, status, salesperson or PO..."
                  value={quoteSearch}
                  onChange={(e) => setQuoteSearch(e.target.value)}
                />
                {quoteSearch && (
                  <button
                    className="clear-search"
                    onClick={() => setQuoteSearch("")}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="client-result-bar">
                <span>
                  {filteredQuotes.length}{" "}
                  {filteredQuotes.length === 1
                    ? "quote"
                    : "quotes"}
                </span>
              </div>

              <section className="client-list-panel">
                {quotesLoading ? (
                  <div className="empty-state">
                    Loading quotes...
                  </div>
                ) : filteredQuotes.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">＋</div>
                    <strong>
                      {showArchivedQuotes
                        ? "No archived quotes"
                        : "No quotes yet"}
                    </strong>
                    <span>
                      {showArchivedQuotes
                        ? "Archived quotes will appear here and can be restored anytime."
                        : "Create your first quote and the Hub will assign the quote number automatically."}
                    </span>
                  </div>
                ) : (
                  <div className="client-list">
                    {filteredQuotes.map((quote) => {
                      const items =
                        quoteItemsSummary[quote.id] || [];
                      const merchandise = items.reduce(
                        (sum, item) =>
                          sum +
                          numberOrZero(item.quantity) *
                            numberOrZero(item.unit_price),
                        0
                      );
                      const total =
                        merchandise +
                        numberOrZero(quote.freight_amount) +
                        numberOrZero(quote.adjustment_amount);

                      return (
                        <button
                          key={quote.id}
                          className="quote-row"
                          onClick={() => openQuote(quote)}
                        >
                          <div className="quote-number">
                            <span>QUOTE</span>
                            <strong>
                              #{quote.quote_number}
                            </strong>
                          </div>

                          <div className="quote-main">
                            <strong>
                              {clientNameById(quote.client_id)}
                            </strong>
                            <span>
                              {quote.quote_date}
                              {quote.customer_po
                                ? ` • PO ${quote.customer_po}`
                                : ""}
                            </span>
                          </div>

                          <div className="quote-status">
                            {quote.status}
                          </div>

                          <div className="quote-items-count">
                            <span>ITEMS</span>
                            <strong>{items.length}</strong>
                          </div>

                          <div className="quote-total">
                            <span>TOTAL</span>
                            <strong>{money(total)}</strong>
                          </div>

                          <div className="chevron">›</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </section>
          )}

        </main>
      </div>

      {clientModalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeClientModal();
            }
          }}
        >
          <section className="client-modal">
            <div className="modal-header">
              <div>
                <div className="detail-kicker">
                  {clientMode === "new"
                    ? "NEW CLIENT"
                    : clientMode === "edit"
                    ? "EDIT CLIENT"
                    : "CLIENT RECORD"}
                </div>

                <h2>
                  {clientMode === "new"
                    ? "Add a client"
                    : selectedClient
                    ? getClientName(selectedClient)
                    : "Client"}
                </h2>
              </div>

              <button
                className="modal-close"
                onClick={closeClientModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {clientMode === "view" && selectedClient ? (
              <>
                <div className="client-hero">
                  <div className="detail-avatar">
                    {getClientName(selectedClient)
                      .charAt(0)
                      .toUpperCase()}
                  </div>

                  <div>
                    <strong>{getClientName(selectedClient)}</strong>
                    <span>
                      {getLocation(selectedClient) ||
                        "Location not entered"}
                    </span>
                  </div>
                </div>

                <div className="detail-grid">
                  <DetailField
                    label="Salesperson"
                    value={salespersonName(
                      selectedClient.assigned_user_id
                    )}
                  />

                  <DetailField
                    label="Phone"
                    value={selectedClient.phone}
                  />

                  <DetailField
                    label="Email"
                    value={selectedClient.email}
                  />

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

                  <DetailField
                    label="Tax Exempt"
                    value={
                      selectedClient.tax_exempt ? "Yes" : "Not marked"
                    }
                  />
                </div>

                {selectedClient.notes && (
                  <div className="notes-box">
                    <span>NOTES</span>
                    <p>{selectedClient.notes}</p>
                  </div>
                )}

                <div className="modal-actions">
                  <button
                    className="modal-primary"
                    onClick={beginEdit}
                  >
                    Edit Client
                  </button>

                  <button
                    className="delete-button"
                    onClick={deleteClient}
                    disabled={savingClient}
                  >
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-grid">
                  <FormField label="Client name" wide>
                    <input
                      value={clientForm.client_name}
                      onChange={(e) =>
                        updateForm("client_name", e.target.value)
                      }
                      placeholder="Client or company name"
                    />
                  </FormField>

                  <FormField label="Salesperson" wide>
                    <select
                      value={clientForm.assigned_user_id}
                      onChange={(e) =>
                        updateForm(
                          "assigned_user_id",
                          e.target.value
                        )
                      }
                    >
                      <option value="">Unassigned</option>
                      {team.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.display_name}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField label="Phone">
                    <input
                      value={clientForm.phone}
                      onChange={(e) =>
                        updateForm("phone", e.target.value)
                      }
                      placeholder="Phone"
                    />
                  </FormField>

                  <FormField label="Email">
                    <input
                      type="email"
                      value={clientForm.email}
                      onChange={(e) =>
                        updateForm("email", e.target.value)
                      }
                      placeholder="Email"
                    />
                  </FormField>

                  <FormField label="Street address" wide>
                    <input
                      value={clientForm.street_address}
                      onChange={(e) =>
                        updateForm(
                          "street_address",
                          e.target.value
                        )
                      }
                      placeholder="Street address"
                    />
                  </FormField>

                  <FormField label="City">
                    <input
                      value={clientForm.city}
                      onChange={(e) =>
                        updateForm("city", e.target.value)
                      }
                      placeholder="City"
                    />
                  </FormField>

                  <FormField label="State">
                    <input
                      value={clientForm.state}
                      onChange={(e) =>
                        updateForm("state", e.target.value)
                      }
                      placeholder="TX"
                      maxLength={2}
                    />
                  </FormField>

                  <FormField label="ZIP code">
                    <input
                      value={clientForm.zip_code}
                      onChange={(e) =>
                        updateForm("zip_code", e.target.value)
                      }
                      placeholder="ZIP"
                    />
                  </FormField>

                  <FormField label="Tax exempt">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={clientForm.tax_exempt}
                        onChange={(e) =>
                          updateForm(
                            "tax_exempt",
                            e.target.checked
                          )
                        }
                      />
                      Tax exempt client
                    </label>
                  </FormField>

                  <FormField label="Notes" wide>
                    <textarea
                      value={clientForm.notes}
                      onChange={(e) =>
                        updateForm("notes", e.target.value)
                      }
                      placeholder="Client notes"
                      rows={4}
                    />
                  </FormField>
                </div>

                <div className="modal-actions">
                  <button
                    className="modal-primary"
                    onClick={saveClient}
                    disabled={savingClient}
                  >
                    {savingClient
                      ? "Saving..."
                      : clientMode === "new"
                      ? "Create Client"
                      : "Save Changes"}
                  </button>

                  <button
                    className="modal-secondary"
                    onClick={() => {
                      if (clientMode === "edit" && selectedClient) {
                        setClientMode("view");
                        setClientForm(clientToForm(selectedClient));
                      } else {
                        closeClientModal();
                      }
                    }}
                    disabled={savingClient}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {manufacturerModalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeManufacturerModal();
            }
          }}
        >
          <section className="client-modal">
            <div className="modal-header">
              <div>
                <div className="detail-kicker">
                  {manufacturerMode === "new"
                    ? "NEW MANUFACTURER"
                    : manufacturerMode === "edit"
                    ? "EDIT MANUFACTURER"
                    : "MANUFACTURER"}
                </div>

                <h2>
                  {manufacturerMode === "new"
                    ? "Add a manufacturer"
                    : selectedManufacturer?.name ||
                      "Manufacturer"}
                </h2>
              </div>

              <button
                className="modal-close"
                onClick={closeManufacturerModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {manufacturerMode === "view" &&
            selectedManufacturer ? (
              <>
                <div className="manufacturer-detail-hero">
                  <div className="manufacturer-mark large">
                    {selectedManufacturer.name
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div>
                    <strong>{selectedManufacturer.name}</strong>
                    <span>
                      {selectedManufacturer.active === false
                        ? "Inactive manufacturer"
                        : "Active manufacturer"}
                    </span>
                  </div>
                </div>

                <div className="detail-grid">
                  <DetailField
                    label="Account #"
                    value={selectedManufacturer.account_number}
                  />
                  <DetailField
                    label="Orders Email"
                    value={selectedManufacturer.orders_email}
                  />
                  <DetailField
                    label="Phone"
                    value={selectedManufacturer.phone}
                  />
                  <DetailField
                    label="Terms"
                    value={selectedManufacturer.terms}
                  />
                  <DetailField
                    label="Purchasing Factor"
                    value={
                      selectedManufacturer.purchasing_factor != null
                        ? selectedManufacturer.purchasing_factor.toString()
                        : null
                    }
                  />
                  <DetailField
                    label="Default Discount"
                    value={
                      selectedManufacturer.default_discount_pct != null
                        ? `${selectedManufacturer.default_discount_pct}%`
                        : null
                    }
                  />
                  <DetailField
                    label="Tariff"
                    value={
                      selectedManufacturer.tariff_pct != null
                        ? `${selectedManufacturer.tariff_pct}%`
                        : null
                    }
                  />
                  <DetailField
                    label="Surcharge"
                    value={
                      selectedManufacturer.surcharge_pct != null
                        ? `${selectedManufacturer.surcharge_pct}%`
                        : null
                    }
                  />
                </div>

                <CostPreview
                  manufacturer={selectedManufacturer}
                />

                {selectedManufacturer.notes && (
                  <div className="notes-box">
                    <span>NOTES</span>
                    <p>{selectedManufacturer.notes}</p>
                  </div>
                )}

                <div className="modal-actions">
                  <button
                    className="modal-primary"
                    onClick={beginManufacturerEdit}
                  >
                    Edit Manufacturer
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-grid">
                  <FormField label="Manufacturer name" wide>
                    <input
                      value={manufacturerForm.name}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "name",
                          e.target.value
                        )
                      }
                      placeholder="Manufacturer name"
                    />
                  </FormField>

                  <FormField label="Account number">
                    <input
                      value={manufacturerForm.account_number}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "account_number",
                          e.target.value
                        )
                      }
                      placeholder="Account #"
                    />
                  </FormField>

                  <FormField label="Terms">
                    <input
                      value={manufacturerForm.terms}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "terms",
                          e.target.value
                        )
                      }
                      placeholder="Net 30, Prepay, etc."
                    />
                  </FormField>

                  <FormField label="Orders email">
                    <input
                      type="email"
                      value={manufacturerForm.orders_email}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "orders_email",
                          e.target.value
                        )
                      }
                      placeholder="orders@vendor.com"
                    />
                  </FormField>

                  <FormField label="Phone">
                    <input
                      value={manufacturerForm.phone}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "phone",
                          e.target.value
                        )
                      }
                      placeholder="Phone"
                    />
                  </FormField>

                  <FormField label="Purchasing factor">
                    <input
                      inputMode="decimal"
                      value={manufacturerForm.purchasing_factor}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "purchasing_factor",
                          e.target.value
                        )
                      }
                      placeholder="0.45"
                    />
                  </FormField>

                  <FormField label="Default customer discount %">
                    <input
                      inputMode="decimal"
                      value={
                        manufacturerForm.default_discount_pct
                      }
                      onChange={(e) =>
                        updateManufacturerForm(
                          "default_discount_pct",
                          e.target.value
                        )
                      }
                      placeholder="20"
                    />
                  </FormField>

                  <FormField label="Tariff %">
                    <input
                      inputMode="decimal"
                      value={manufacturerForm.tariff_pct}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "tariff_pct",
                          e.target.value
                        )
                      }
                      placeholder="0"
                    />
                  </FormField>

                  <FormField label="Surcharge %">
                    <input
                      inputMode="decimal"
                      value={manufacturerForm.surcharge_pct}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "surcharge_pct",
                          e.target.value
                        )
                      }
                      placeholder="0"
                    />
                  </FormField>

                  <FormField label="Status" wide>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={manufacturerForm.active}
                        onChange={(e) =>
                          updateManufacturerForm(
                            "active",
                            e.target.checked
                          )
                        }
                      />
                      Active manufacturer
                    </label>
                  </FormField>

                  <FormField label="Notes" wide>
                    <textarea
                      value={manufacturerForm.notes}
                      onChange={(e) =>
                        updateManufacturerForm(
                          "notes",
                          e.target.value
                        )
                      }
                      placeholder="Pricing notes, ordering instructions, contacts, account details..."
                      rows={4}
                    />
                  </FormField>
                </div>

                <div className="manufacturer-help">
                  <strong>How pricing will use these fields</strong>
                  <span>
                    Purchasing factor calculates expected vendor cost.
                    Default discount pre-fills the customer discount on
                    quote lines. Tariff and surcharge are added to
                    expected cost and can be carried into the quote.
                  </span>
                </div>

                <div className="modal-actions">
                  <button
                    className="modal-primary"
                    onClick={saveManufacturer}
                    disabled={savingManufacturer}
                  >
                    {savingManufacturer
                      ? "Saving..."
                      : manufacturerMode === "new"
                      ? "Create Manufacturer"
                      : "Save Changes"}
                  </button>

                  <button
                    className="modal-secondary"
                    onClick={() => {
                      if (
                        manufacturerMode === "edit" &&
                        selectedManufacturer
                      ) {
                        setManufacturerMode("view");
                        setManufacturerForm(
                          manufacturerToForm(
                            selectedManufacturer
                          )
                        );
                      } else {
                        closeManufacturerModal();
                      }
                    }}
                    disabled={savingManufacturer}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {quoteEditorOpen && (
        <div className="quote-editor-backdrop">
          <section className="quote-editor">
            <div className="quote-editor-header">
              <div>
                <div className="detail-kicker">
                  {selectedQuote
                    ? `QUOTE #${selectedQuote.quote_number}`
                    : "NEW QUOTE"}
                </div>
                <h2>
                  {selectedQuote
                    ? clientNameById(quoteForm.client_id)
                    : "Create Quote"}
                </h2>
              </div>

              <div className="quote-header-actions">
                {selectedQuote && (
                  <>
                    <button
                      className="modal-secondary"
                      onClick={downloadQuotePdf}
                      disabled={savingQuote}
                    >
                      Download PDF
                    </button>
                    <button
                      className="archive-button"
                      onClick={toggleQuoteArchive}
                      disabled={savingQuote}
                    >
                      {selectedQuote.status === "Archived"
                        ? "Unarchive"
                        : "Archive"}
                    </button>
                    <button
                      className="delete-button"
                      onClick={deleteQuote}
                      disabled={savingQuote}
                    >
                      Delete
                    </button>
                  </>
                )}
                <button
                  className="modal-close"
                  onClick={closeQuoteEditor}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="quote-editor-body">
              <section className="quote-card">
                <div className="quote-card-title">
                  Quote Details
                </div>

                <div className="quote-header-grid">
                  <FormField label="Client" wide>
                    <select
                      value={quoteForm.client_id}
                      onChange={(e) =>
                        updateQuoteForm(
                          "client_id",
                          e.target.value
                        )
                      }
                    >
                      <option value="">Choose client...</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {getClientName(client)}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField label="Salesperson">
                    <select
                      value={quoteForm.salesperson_user_id}
                      onChange={(e) =>
                        updateQuoteForm(
                          "salesperson_user_id",
                          e.target.value
                        )
                      }
                    >
                      <option value="">Unassigned</option>
                      {team.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.display_name}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField label="Status">
                    <select
                      value={quoteForm.status}
                      onChange={(e) =>
                        updateQuoteForm(
                          "status",
                          e.target.value
                        )
                      }
                    >
                      <option>Draft</option>
                      <option>Sent</option>
                      <option>Approved</option>
                      <option>Declined</option>
                      <option value="Archived" disabled>Archived</option>
                    </select>
                  </FormField>

                  <FormField label="Quote date">
                    <input
                      type="date"
                      value={quoteForm.quote_date}
                      onChange={(e) =>
                        updateQuoteForm(
                          "quote_date",
                          e.target.value
                        )
                      }
                    />
                  </FormField>

                  <FormField label="Expiration date">
                    <input
                      type="date"
                      value={quoteForm.expiration_date}
                      onChange={(e) =>
                        updateQuoteForm(
                          "expiration_date",
                          e.target.value
                        )
                      }
                    />
                  </FormField>

                  <FormField label="Customer PO" wide>
                    <input
                      value={quoteForm.customer_po}
                      onChange={(e) =>
                        updateQuoteForm(
                          "customer_po",
                          e.target.value
                        )
                      }
                      placeholder="Optional PO / project reference"
                    />
                  </FormField>
                </div>
              </section>

              <section className="quote-card">
                <div className="quote-lines-heading">
                  <div>
                    <div className="quote-card-title">
                      Line Items
                    </div>
                    <p>
                      Manufacturer settings automatically seed the
                      customer discount and expected cost snapshots.
                    </p>
                  </div>

                  <button
                    className="line-add-button"
                    onClick={addQuoteItem}
                  >
                    + Add Item
                  </button>
                </div>

                <div className="quote-line-list">
                  {quoteItems.map((item, index) => {
                    const manufacturer = manufacturers.find(
                      (manufacturer) =>
                        manufacturer.id === item.manufacturer_id
                    );
                    const extended =
                      numberOrZero(item.quantity) *
                      numberOrZero(item.unit_price);
                    const expectedExtended =
                      numberOrZero(item.quantity) *
                      numberOrZero(item.expected_unit_cost);

                    return (
                      <article
                        className="quote-line-card"
                        key={item.local_id}
                      >
                        <div className="quote-line-top">
                          <div className="line-number">
                            Item {index + 1}
                          </div>
                          <button
                            className="line-remove-button"
                            onClick={() =>
                              removeQuoteItem(item.local_id)
                            }
                          >
                            Remove
                          </button>
                        </div>

                        <div className="quote-line-grid">
                          <FormField
                            label="Manufacturer"
                            wide
                          >
                            <select
                              value={item.manufacturer_id}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "manufacturer_id",
                                  e.target.value
                                )
                              }
                            >
                              <option value="">
                                Choose manufacturer...
                              </option>
                              {manufacturers
                                .filter(
                                  (manufacturer) =>
                                    manufacturer.active !== false
                                )
                                .map((manufacturer) => (
                                  <option
                                    key={manufacturer.id}
                                    value={manufacturer.id}
                                  >
                                    {manufacturer.name}
                                  </option>
                                ))}
                            </select>
                          </FormField>

                          <FormField label="Qty">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "quantity",
                                  e.target.value.replace(/[^0-9]/g, "")
                                )
                              }
                              onBlur={() =>
                                updateQuoteItem(
                                  item.local_id,
                                  "quantity",
                                  String(
                                    Math.max(
                                      1,
                                      numberOrZero(item.quantity)
                                    )
                                  )
                                )
                              }
                            />
                          </FormField>

                          <FormField label="SKU">
                            <input
                              value={item.sku}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "sku",
                                  e.target.value
                                )
                              }
                              placeholder="SKU"
                            />
                          </FormField>

                          <FormField label="Description" wide>
                            <input
                              value={item.description}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "description",
                                  e.target.value
                                )
                              }
                              placeholder="Product description"
                            />
                          </FormField>

                          <FormField label="Finish">
                            <input
                              value={item.finish}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "finish",
                                  e.target.value
                                )
                              }
                              placeholder="Finish"
                            />
                          </FormField>

                          <FormField label="Fabric Name">
                            <input
                              value={item.fabric_name}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "fabric_name",
                                  e.target.value
                                )
                              }
                              placeholder="Fabric"
                            />
                          </FormField>

                          <FormField label="Grade">
                            <input
                              value={item.grade}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "grade",
                                  e.target.value
                                )
                              }
                              placeholder="Grade"
                            />
                          </FormField>

                          <FormField label="MSRP @ Grade">
                            <input
                              inputMode="decimal"
                              value={
                                item.msrp_at_grade || ""
                              }
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "msrp_at_grade",
                                  numberOrZero(e.target.value)
                                )
                              }
                              placeholder="0.00"
                            />
                          </FormField>

                          <FormField label="Discount %">
                            <input
                              inputMode="decimal"
                              value={item.discount_pct}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "discount_pct",
                                  numberOrZero(e.target.value)
                                )
                              }
                            />
                          </FormField>

                          <FormField label="Item Price">
                            <input
                              value={money(item.unit_price)}
                              readOnly
                            />
                          </FormField>

                          <FormField
                            label="Additional Details"
                            wide
                          >
                            <textarea
                              rows={2}
                              value={item.additional_details}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "additional_details",
                                  e.target.value
                                )
                              }
                              placeholder="Custom details, dimensions, COM notes, etc."
                            />
                          </FormField>
                        </div>

                        <div className="line-financials">
                          <div>
                            <span>Extended</span>
                            <strong>{money(extended)}</strong>
                          </div>
                          <div>
                            <span>Expected Cost</span>
                            <strong>
                              {item.expected_unit_cost == null
                                ? "Factor needed"
                                : money(expectedExtended)}
                            </strong>
                          </div>
                          <div>
                            <span>Factor</span>
                            <strong>
                              {item.purchasing_factor_snapshot ??
                                "—"}
                            </strong>
                          </div>
                          <div>
                            <span>Tariff</span>
                            <strong>
                              {numberOrZero(
                                item.tariff_pct_snapshot
                              )}
                              %
                            </strong>
                          </div>
                          <div>
                            <span>Surcharge</span>
                            <strong>
                              {numberOrZero(
                                item.surcharge_pct_snapshot
                              )}
                              %
                            </strong>
                          </div>
                          <label className="commission-toggle">
                            <input
                              type="checkbox"
                              checked={item.commissionable}
                              onChange={(e) =>
                                updateQuoteItem(
                                  item.local_id,
                                  "commissionable",
                                  e.target.checked
                                )
                              }
                            />
                            Commissionable
                          </label>
                        </div>

                        {manufacturer &&
                          manufacturer.purchasing_factor == null && (
                            <div className="line-warning">
                              {manufacturer.name} does not have a
                              purchasing factor yet. Customer pricing
                              will save, but expected cost and margin
                              cannot be calculated.
                            </div>
                          )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <div className="quote-bottom-grid">
                <section className="quote-card">
                  <div className="quote-card-title">
                    Quote Notes
                  </div>
                  <textarea
                    className="quote-notes"
                    rows={6}
                    value={quoteForm.notes}
                    onChange={(e) =>
                      updateQuoteForm(
                        "notes",
                        e.target.value
                      )
                    }
                    placeholder="Internal or quote notes..."
                  />
                </section>

                <section className="quote-card quote-summary-card">
                  <div className="quote-card-title">
                    Quote Summary
                  </div>

                  <div className="summary-row">
                    <span>Merchandise</span>
                    <strong>
                      {money(quoteEditorTotals.merchandise)}
                    </strong>
                  </div>

                  <div className="summary-input-row">
                    <label>Freight</label>
                    <input
                      inputMode="decimal"
                      value={quoteForm.freight_amount}
                      onChange={(e) =>
                        updateQuoteForm(
                          "freight_amount",
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <div className="summary-input-row">
                    <label>Adjustment</label>
                    <input
                      inputMode="decimal"
                      value={quoteForm.adjustment_amount}
                      onChange={(e) =>
                        updateQuoteForm(
                          "adjustment_amount",
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <div className="summary-total">
                    <span>Quote Total</span>
                    <strong>
                      {money(quoteEditorTotals.total)}
                    </strong>
                  </div>

                  <div className="internal-cost-summary">
                    <div>
                      <span>Expected merchandise cost</span>
                      <strong>
                        {money(quoteEditorTotals.expectedCost)}
                      </strong>
                    </div>
                    <div>
                      <span>Estimated merchandise margin</span>
                      <strong>
                        {money(quoteEditorTotals.marginDollar)} •{" "}
                        {quoteEditorTotals.marginPct.toFixed(1)}%
                      </strong>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div className="quote-editor-footer">
              <button
                className="modal-secondary"
                onClick={closeQuoteEditor}
                disabled={savingQuote}
              >
                Close
              </button>

              <button
                className="modal-primary quote-save-button"
                onClick={saveQuote}
                disabled={savingQuote}
              >
                {savingQuote
                  ? "Saving..."
                  : selectedQuote
                  ? "Save Quote"
                  : "Create Draft Quote"}
              </button>
            </div>
          </section>
        </div>
      )}

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


function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ManufacturerMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="manufacturer-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CostPreview({
  manufacturer,
}: {
  manufacturer: Manufacturer;
}) {
  const msrp = 1000;
  const factor = Number(manufacturer.purchasing_factor || 0);
  const tariff = Number(manufacturer.tariff_pct || 0) / 100;
  const surcharge =
    Number(manufacturer.surcharge_pct || 0) / 100;
  const discount =
    Number(manufacturer.default_discount_pct || 0) / 100;

  const baseCost = msrp * factor;
  const expectedCost =
    baseCost * (1 + tariff + surcharge);
  const customerPrice = msrp * (1 - discount);

  return (
    <div className="cost-preview">
      <div>
        <span>EXAMPLE ON $1,000 MSRP</span>
        <strong>Pricing preview</strong>
      </div>
      <div className="cost-preview-grid">
        <div>
          <span>Customer price</span>
          <strong>{money(customerPrice)}</strong>
        </div>
        <div>
          <span>Base vendor cost</span>
          <strong>{money(baseCost)}</strong>
        </div>
        <div>
          <span>Expected cost w/ tariff + surcharge</span>
          <strong>{money(expectedCost)}</strong>
        </div>
      </div>
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

function FormField({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`form-field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const appCss = `
  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: #f3f6f8;
    color: #173a59;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system,
      BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  button, input, select, textarea { font: inherit; }
  button { cursor: pointer; }

  .login-screen {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
    background:
      radial-gradient(circle at top right,
      rgba(54,126,174,.22), transparent 34rem),
      #f2f6f8;
  }

  .login-card, .loading-card {
    width: 100%;
    max-width: 460px;
    background: white;
    border: 1px solid #dce6ec;
    border-radius: 24px;
    padding: 30px;
    box-shadow: 0 22px 60px rgba(22,54,78,.12);
  }

  .loading-card { text-align: center; font-weight: 800; }

  .login-logo, .brand-logo {
    display: grid;
    place-items: center;
    background: linear-gradient(145deg,#153a58,#3881af);
    color: white;
    font-weight: 900;
  }

  .login-logo {
    width: 58px;
    height: 58px;
    border-radius: 18px;
    margin-bottom: 22px;
  }

  .eyebrow, .section-eyebrow, .panel-eyebrow,
  .detail-kicker {
    font-size: 10px;
    font-weight: 900;
    letter-spacing: .12em;
    color: #78909f;
  }

  .login-card h1 {
    margin: 3px 0 0;
    font-size: 40px;
    color: #173a59;
  }

  .login-subtitle { color: #6d7d87; margin-top: 4px; }
  .login-rule { height: 1px; background: #e4ebef; margin: 24px 0; }

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

  .login-message, .notice {
    background: #edf6fb;
    color: #285879;
    border-radius: 10px;
    padding: 11px 13px;
  }

  .login-message { margin-top: 14px; }

  .internal-note {
    color: #8a979f;
    font-size: 11px;
    text-align: center;
    margin-top: 20px;
  }

  .hub-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 245px minmax(0,1fr);
  }

  .sidebar {
    min-height: 100vh;
    background: linear-gradient(180deg,#102c43 0%,#173a59 52%,#15344f 100%);
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

  .brand-name { font-weight: 900; font-size: 14px; }

  .brand-hub {
    margin-top: 2px;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: .25em;
    opacity: .6;
  }

  .sidebar-user {
    background: rgba(255,255,255,.075);
    border: 1px solid rgba(255,255,255,.08);
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

  .sidebar-role { margin-top: 3px; font-size: 9px; opacity: .62; }

  .nav-group { margin-top: 18px; }

  .nav-heading {
    padding: 0 10px 5px;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: .13em;
    opacity: .4;
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
    color: rgba(255,255,255,.82);
    font-size: 11px;
    font-weight: 750;
    text-align: left;
  }

  .nav-button:hover { background: rgba(255,255,255,.06); }
  .nav-button.active { background: rgba(255,255,255,.14); color: white; }
  .nav-button span { width: 17px; text-align: center; opacity: .8; }

  .main-area { min-width: 0; padding: 25px 28px 40px; }

  .topbar {
    min-height: 49px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
    margin-bottom: 18px;
  }

  .topbar-title { color: #173a59; font-weight: 900; font-size: 16px; }
  .topbar-subtitle { color: #82919a; font-size: 10px; margin-top: 2px; }

  .signout-button, .text-button {
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
      radial-gradient(circle at 85% 20%,
      rgba(255,255,255,.16), transparent 15rem),
      linear-gradient(125deg,#173a59,#2f719e);
    box-shadow: 0 16px 35px rgba(23,58,89,.14);
  }

  .welcome-role {
    display: inline-block;
    border-radius: 999px;
    padding: 5px 9px;
    background: rgba(255,255,255,.14);
    font-size: 9px;
    font-weight: 850;
  }

  .welcome-card h1 { margin: 13px 0 4px; font-size: 29px; }
  .welcome-card p { margin: 0; color: rgba(255,255,255,.78); font-size: 13px; }

  .welcome-action {
    white-space: nowrap;
    border: 1px solid rgba(255,255,255,.2);
    background: rgba(255,255,255,.12);
    color: white;
    border-radius: 10px;
    padding: 10px 13px;
    font-size: 10px;
    font-weight: 850;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4,minmax(0,1fr));
    gap: 13px;
    margin-top: 15px;
  }

  .stat-card, .panel, .search-card, .client-list-panel {
    background: white;
    border: 1px solid #dfe7ec;
    box-shadow: 0 7px 22px rgba(22,48,70,.045);
  }

  .stat-card { border-radius: 15px; padding: 16px; }
  .stat-label { color: #81909a; font-size: 9px; font-weight: 900; letter-spacing: .08em; }
  .stat-value { margin-top: 6px; color: #173a59; font-size: 24px; font-weight: 950; }
  .stat-detail { margin-top: 2px; color: #87949c; font-size: 9px; }

  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0,1.4fr) minmax(280px,.8fr);
    gap: 15px;
    margin-top: 15px;
  }

  .panel { border-radius: 17px; padding: 18px; }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .panel h2, .system-panel h2 {
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

  .client-initial, .detail-avatar {
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

  .quick-client-copy { min-width: 0; }

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

  .chevron { color: #9eabb3; font-size: 19px; }

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

  .status-row strong { color: #2d6b58; text-align: right; }
  .status-dot { color: #3d9174; margin-right: 7px; }

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

  .commission-box span { color: #71818b; font-size: 10px; }
  .commission-box strong { color: #173a59; font-size: 20px; }

  .page-heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 20px;
    margin-bottom: 16px;
  }

  .page-heading h1 { margin: 4px 0 3px; color: #173a59; font-size: 28px; }
  .page-heading p { margin: 0; color: #7a8993; font-size: 11px; }

  .new-client-button {
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

  .search-icon { color: #71838e; font-size: 20px; }

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

  .client-list-panel {
    border-radius: 16px;
    overflow: hidden;
  }

  .client-list { max-height: 70vh; overflow: auto; }

  .client-row {
    width: 100%;
    display: grid;
    grid-template-columns:
      auto minmax(160px,1fr) minmax(150px,.8fr)
      minmax(130px,.65fr) auto;
    align-items: center;
    gap: 11px;
    border: 0;
    border-bottom: 1px solid #edf1f4;
    padding: 11px 13px;
    background: white;
    text-align: left;
  }

  .client-row:hover { background: #f3f8fb; }

  .client-row-main, .client-row-contact, .client-row-sales {
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

  .client-row-main span, .client-row-contact span {
    display: block;
    overflow: hidden;
    color: #85939c;
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .client-row-main span { margin-top: 2px; }
  .client-row-contact span + span { margin-top: 3px; }

  .client-row-sales span {
    display: block;
    color: #9aa6ad;
    font-size: 8px;
    text-transform: uppercase;
  }

  .client-row-sales strong {
    display: block;
    overflow: hidden;
    margin-top: 2px;
    color: #4c6575;
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .empty-icon { font-size: 25px; color: #5684a2; }

  .modal-backdrop {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(12,30,44,.56);
    backdrop-filter: blur(5px);
  }

  .client-modal {
    width: min(680px,100%);
    max-height: 90vh;
    overflow: auto;
    background: white;
    border-radius: 22px;
    box-shadow: 0 28px 80px rgba(6,25,40,.3);
    padding: 22px;
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 15px;
    padding-bottom: 16px;
    border-bottom: 1px solid #e8eef2;
  }

  .modal-header h2 {
    margin: 4px 0 0;
    color: #173a59;
    font-size: 23px;
  }

  .modal-close {
    width: 38px;
    height: 38px;
    border: 1px solid #d9e3e8;
    border-radius: 11px;
    background: white;
    color: #617580;
    font-size: 22px;
    line-height: 1;
  }

  .client-hero {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 20px 0 16px;
  }

  .detail-avatar {
    width: 52px;
    height: 52px;
    border-radius: 15px;
    flex: 0 0 auto;
  }

  .client-hero strong {
    display: block;
    color: #173a59;
    font-size: 17px;
  }

  .client-hero span {
    display: block;
    margin-top: 3px;
    color: #81909a;
    font-size: 11px;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2,minmax(0,1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid #e2e9ed;
    border-radius: 14px;
    background: #e2e9ed;
  }

  .detail-field {
    min-width: 0;
    background: #f9fbfc;
    padding: 13px;
  }

  .detail-field span {
    display: block;
    color: #8b989f;
    font-size: 8px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: .06em;
  }

  .detail-field strong {
    display: block;
    margin-top: 4px;
    overflow-wrap: anywhere;
    color: #36586d;
    font-size: 11px;
  }

  .notes-box {
    margin-top: 15px;
    background: #f5f8fa;
    border-radius: 12px;
    padding: 13px;
  }

  .notes-box span {
    color: #89979f;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: .08em;
  }

  .notes-box p {
    margin: 5px 0 0;
    color: #536d7d;
    font-size: 11px;
    line-height: 1.5;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(2,minmax(0,1fr));
    gap: 13px;
    padding-top: 18px;
  }

  .form-field {
    display: block;
    min-width: 0;
  }

  .form-field.wide { grid-column: 1 / -1; }

  .form-field > span {
    display: block;
    margin-bottom: 6px;
    color: #647984;
    font-size: 10px;
    font-weight: 850;
  }

  .form-field input:not([type="checkbox"]),
  .form-field select,
  .form-field textarea {
    width: 100%;
    border: 1px solid #cfdce3;
    border-radius: 10px;
    background: white;
    color: #294c62;
    padding: 10px 11px;
    outline: none;
  }

  .form-field textarea { resize: vertical; }

  .form-field input:focus,
  .form-field select:focus,
  .form-field textarea:focus {
    border-color: #3980ad;
    box-shadow: 0 0 0 3px rgba(57,128,173,.1);
  }

  .checkbox-row {
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #4c6878;
    font-size: 11px;
  }

  .modal-actions {
    display: flex;
    gap: 9px;
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid #e8eef2;
  }

  .modal-primary, .modal-secondary, .delete-button {
    border-radius: 10px;
    padding: 10px 13px;
    font-size: 10px;
    font-weight: 850;
  }

  .modal-primary {
    flex: 1;
    border: 0;
    background: #173a59;
    color: white;
  }

  .modal-secondary {
    border: 1px solid #cedbe2;
    background: white;
    color: #3f6073;
  }

  .delete-button {
    border: 1px solid #eccbcb;
    background: #fff7f7;
    color: #a44848;
  }

  .modal-primary:disabled, .modal-secondary:disabled,
  .delete-button:disabled {
    cursor: not-allowed;
    opacity: .55;
  }


  .manufacturer-stats {
    display: grid;
    grid-template-columns: repeat(3,minmax(0,1fr));
    gap: 10px;
    margin-bottom: 12px;
  }

  .mini-stat {
    background: white;
    border: 1px solid #dfe7ec;
    border-radius: 13px;
    padding: 12px 14px;
  }

  .mini-stat span,
  .manufacturer-metric span {
    display: block;
    color: #8a979f;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: .07em;
    text-transform: uppercase;
  }

  .mini-stat strong {
    display: block;
    margin-top: 4px;
    color: #173a59;
    font-size: 19px;
  }

  .manufacturer-row {
    width: 100%;
    display: grid;
    grid-template-columns:
      auto minmax(190px,1fr)
      repeat(4,minmax(80px,.45fr)) auto;
    align-items: center;
    gap: 12px;
    border: 0;
    border-bottom: 1px solid #edf1f4;
    padding: 12px 13px;
    background: white;
    text-align: left;
  }

  .manufacturer-row:hover { background: #f3f8fb; }

  .manufacturer-mark {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: linear-gradient(145deg,#e5f0f6,#d3e7f2);
    color: #285a7b;
    font-weight: 950;
    font-size: 12px;
  }

  .manufacturer-mark.large {
    width: 52px;
    height: 52px;
    border-radius: 15px;
    font-size: 17px;
  }

  .manufacturer-main { min-width: 0; }

  .manufacturer-main strong {
    display: block;
    overflow: hidden;
    color: #274b63;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .manufacturer-main span {
    display: block;
    margin-top: 3px;
    color: #89969e;
    font-size: 9px;
  }

  .manufacturer-metric {
    min-width: 0;
  }

  .manufacturer-metric strong {
    display: block;
    margin-top: 3px;
    color: #3d5f72;
    font-size: 10px;
  }

  .manufacturer-detail-hero {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 20px 0 16px;
  }

  .manufacturer-detail-hero strong {
    display: block;
    color: #173a59;
    font-size: 18px;
  }

  .manufacturer-detail-hero span {
    display: block;
    margin-top: 3px;
    color: #81909a;
    font-size: 10px;
  }

  .cost-preview {
    margin-top: 15px;
    border-radius: 13px;
    padding: 14px;
    background:
      linear-gradient(135deg,#173a59,#2b6f9c);
    color: white;
  }

  .cost-preview > div:first-child span {
    display: block;
    opacity: .6;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: .08em;
  }

  .cost-preview > div:first-child strong {
    display: block;
    margin-top: 3px;
    font-size: 14px;
  }

  .cost-preview-grid {
    display: grid;
    grid-template-columns: repeat(3,minmax(0,1fr));
    gap: 8px;
    margin-top: 12px;
  }

  .cost-preview-grid div {
    border-radius: 10px;
    padding: 10px;
    background: rgba(255,255,255,.1);
  }

  .cost-preview-grid span {
    display: block;
    min-height: 24px;
    color: rgba(255,255,255,.68);
    font-size: 8px;
    line-height: 1.35;
  }

  .cost-preview-grid strong {
    display: block;
    margin-top: 4px;
    font-size: 12px;
  }

  .manufacturer-help {
    margin-top: 15px;
    border-radius: 12px;
    padding: 12px 13px;
    background: #eef6fa;
    color: #45677a;
  }

  .manufacturer-help strong {
    display: block;
    font-size: 10px;
  }

  .manufacturer-help span {
    display: block;
    margin-top: 4px;
    font-size: 9px;
    line-height: 1.5;
  }


  .quote-stat-grid {
    display: grid;
    grid-template-columns: repeat(4,minmax(0,1fr));
    gap: 10px;
    margin-bottom: 12px;
  }


  .quote-archive-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .quote-archive-tabs button {
    border: 1px solid #d4e0e6;
    border-radius: 999px;
    padding: 8px 12px;
    background: white;
    color: #587080;
    font-size: 10px;
    font-weight: 850;
  }

  .quote-archive-tabs button.active {
    border-color: #285d7d;
    background: #173a59;
    color: white;
  }

  .archive-button {
    border: 1px solid #d2dee5;
    border-radius: 10px;
    padding: 9px 11px;
    background: #f4f7f9;
    color: #3f6073;
    font-size: 10px;
    font-weight: 850;
  }

  .quote-row {
    width: 100%;
    display: grid;
    grid-template-columns:
      90px minmax(190px,1fr) 90px 70px 110px auto;
    align-items: center;
    gap: 12px;
    border: 0;
    border-bottom: 1px solid #edf1f4;
    padding: 12px 13px;
    background: white;
    text-align: left;
  }

  .quote-row:hover {
    background: #f3f8fb;
  }

  .quote-number span,
  .quote-items-count span,
  .quote-total span {
    display: block;
    color: #96a2a9;
    font-size: 8px;
    font-weight: 900;
    letter-spacing: .06em;
  }

  .quote-number strong {
    display: block;
    margin-top: 2px;
    color: #285a7b;
    font-size: 12px;
  }

  .quote-main {
    min-width: 0;
  }

  .quote-main strong {
    display: block;
    overflow: hidden;
    color: #274b63;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quote-main span {
    display: block;
    margin-top: 3px;
    color: #89969e;
    font-size: 9px;
  }

  .quote-status {
    justify-self: start;
    border-radius: 999px;
    padding: 5px 8px;
    background: #eaf3f8;
    color: #326585;
    font-size: 9px;
    font-weight: 850;
  }

  .quote-items-count strong,
  .quote-total strong {
    display: block;
    margin-top: 2px;
    color: #3d5f72;
    font-size: 10px;
  }

  .quote-total strong {
    font-size: 11px;
  }

  .quote-editor-backdrop {
    position: fixed;
    z-index: 1200;
    inset: 0;
    background: rgba(10,27,40,.62);
    backdrop-filter: blur(5px);
    padding: 18px;
    overflow: auto;
  }

  .quote-editor {
    width: min(1180px,100%);
    min-height: calc(100vh - 36px);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 22px;
    background: #f3f6f8;
    box-shadow: 0 30px 90px rgba(7,24,37,.35);
  }

  .quote-editor-header,
  .quote-editor-footer {
    background: white;
    padding: 17px 20px;
  }

  .quote-editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
    border-bottom: 1px solid #dfe7ec;
  }

  .quote-editor-header h2 {
    margin: 4px 0 0;
    color: #173a59;
    font-size: 22px;
  }

  .quote-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .quote-editor-body {
    flex: 1;
    padding: 16px;
    overflow: auto;
  }

  .quote-card {
    margin-bottom: 14px;
    border: 1px solid #dfe7ec;
    border-radius: 15px;
    background: white;
    padding: 16px;
    box-shadow: 0 6px 18px rgba(22,48,70,.035);
  }

  .quote-card-title {
    color: #173a59;
    font-size: 13px;
    font-weight: 900;
  }

  .quote-header-grid,
  .quote-line-grid {
    display: grid;
    grid-template-columns: repeat(4,minmax(0,1fr));
    gap: 11px;
    margin-top: 13px;
  }

  .quote-header-grid .wide,
  .quote-line-grid .wide {
    grid-column: span 2;
  }

  .quote-lines-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 15px;
  }

  .quote-lines-heading p {
    margin: 4px 0 0;
    color: #7f8d95;
    font-size: 9px;
  }

  .line-add-button {
    border: 0;
    border-radius: 9px;
    padding: 8px 10px;
    background: #173a59;
    color: white;
    font-size: 9px;
    font-weight: 850;
    white-space: nowrap;
  }

  .quote-line-list {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }

  .quote-line-card {
    border: 1px solid #dce6eb;
    border-radius: 14px;
    background: #fbfcfd;
    padding: 13px;
  }

  .quote-line-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .line-number {
    color: #5f7480;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  .line-remove-button {
    border: 0;
    background: transparent;
    color: #a55252;
    font-size: 9px;
    font-weight: 800;
  }

  .line-financials {
    display: grid;
    grid-template-columns:
      repeat(5,minmax(0,1fr)) minmax(120px,1fr);
    gap: 8px;
    margin-top: 12px;
  }

  .line-financials > div,
  .commission-toggle {
    min-height: 54px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-radius: 10px;
    padding: 8px 9px;
    background: white;
    border: 1px solid #e2e9ed;
  }

  .line-financials span {
    color: #8a979f;
    font-size: 8px;
    font-weight: 850;
    text-transform: uppercase;
  }

  .line-financials strong {
    margin-top: 3px;
    color: #3b5d70;
    font-size: 10px;
  }

  .commission-toggle {
    flex-direction: row;
    align-items: center;
    gap: 7px;
    color: #536d7c;
    font-size: 9px;
    font-weight: 800;
  }

  .line-warning {
    margin-top: 10px;
    border-radius: 9px;
    padding: 9px 10px;
    background: #fff7e8;
    color: #8c671d;
    font-size: 9px;
    line-height: 1.45;
  }

  .quote-bottom-grid {
    display: grid;
    grid-template-columns: minmax(0,1fr) minmax(320px,.7fr);
    gap: 14px;
  }

  .quote-notes {
    width: 100%;
    margin-top: 11px;
    border: 1px solid #cfdce3;
    border-radius: 10px;
    padding: 11px;
    resize: vertical;
    color: #294c62;
  }

  .summary-row,
  .summary-input-row,
  .summary-total {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid #e9eef1;
    color: #5f737f;
    font-size: 10px;
  }

  .summary-input-row input {
    width: 115px;
    border: 1px solid #cedbe2;
    border-radius: 8px;
    padding: 7px 8px;
    color: #294c62;
    text-align: right;
  }

  .summary-total {
    border-bottom: 0;
    padding-top: 14px;
    color: #173a59;
  }

  .summary-total strong {
    font-size: 22px;
  }

  .internal-cost-summary {
    margin-top: 8px;
    border-radius: 10px;
    padding: 10px;
    background: #eef4f7;
  }

  .internal-cost-summary div + div {
    margin-top: 8px;
  }

  .internal-cost-summary span {
    display: block;
    color: #7d8b94;
    font-size: 8px;
    text-transform: uppercase;
    font-weight: 850;
  }

  .internal-cost-summary strong {
    display: block;
    margin-top: 2px;
    color: #385b6e;
    font-size: 10px;
  }

  .quote-editor-footer {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    border-top: 1px solid #dfe7ec;
  }

  .quote-save-button {
    flex: 0 0 auto;
    min-width: 160px;
  }

  @media (max-width: 900px) {
    .hub-shell { grid-template-columns: 1fr; }

    .sidebar {
      min-height: auto;
      padding: 14px;
    }

    .brand-area { padding-bottom: 10px; }
    .sidebar-user { margin-bottom: 10px; }

    .nav-sections {
      display: flex;
      gap: 7px;
      overflow-x: auto;
    }

    .nav-group { display: contents; }

    .nav-heading, .nav-button.future { display: none; }

    .nav-button {
      width: auto;
      flex: 0 0 auto;
      padding: 8px 11px;
      background: rgba(255,255,255,.06);
    }

    .main-area { padding: 17px 14px 30px; }

    .stats-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }

    .dashboard-grid { grid-template-columns: 1fr; }

    .client-list { max-height: none; }

    .client-row {
      grid-template-columns: auto minmax(0,1fr) auto;
    }

    .client-row-contact, .client-row-sales { display: none; }

    .manufacturer-row {
      grid-template-columns: auto minmax(0,1fr) auto;
    }

    .manufacturer-metric { display: none; }

  
  .quote-archive-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .quote-archive-tabs button {
    border: 1px solid #d4e0e6;
    border-radius: 999px;
    padding: 8px 12px;
    background: white;
    color: #587080;
    font-size: 10px;
    font-weight: 850;
  }

  .quote-archive-tabs button.active {
    border-color: #285d7d;
    background: #173a59;
    color: white;
  }

  .archive-button {
    border: 1px solid #d2dee5;
    border-radius: 10px;
    padding: 9px 11px;
    background: #f4f7f9;
    color: #3f6073;
    font-size: 10px;
    font-weight: 850;
  }

  .quote-row {
      grid-template-columns: 70px minmax(0,1fr) auto;
    }

    .quote-status,
    .quote-items-count,
    .quote-total {
      display: none;
    }

    .quote-header-grid,
    .quote-line-grid {
      grid-template-columns: repeat(2,minmax(0,1fr));
    }

    .line-financials {
      grid-template-columns: repeat(3,minmax(0,1fr));
    }

    .quote-bottom-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 650px) {
    .welcome-card {
      min-height: 0;
      display: block;
      padding: 23px;
    }

    .welcome-card h1 { font-size: 25px; }
    .welcome-action { margin-top: 18px; }

    .page-heading { align-items: flex-start; }
    .page-heading h1 { font-size: 25px; }

    .client-modal {
      max-height: 94vh;
      border-radius: 18px;
      padding: 18px;
    }

    .detail-grid, .form-grid,
    .cost-preview-grid { grid-template-columns: 1fr; }

    .manufacturer-stats {
      grid-template-columns: repeat(3,minmax(0,1fr));
    }

    .quote-stat-grid {
      grid-template-columns: repeat(2,minmax(0,1fr));
    }

    .quote-editor-backdrop {
      padding: 0;
    }

    .quote-editor {
      width: 100%;
      min-height: 100vh;
      border-radius: 0;
    }

    .quote-editor-body {
      padding: 10px;
    }

    .quote-header-grid,
    .quote-line-grid,
    .line-financials {
      grid-template-columns: 1fr;
    }

    .quote-header-grid .wide,
    .quote-line-grid .wide {
      grid-column: auto;
    }

    .quote-lines-heading {
      align-items: center;
    }

    .quote-editor-footer {
      position: sticky;
      bottom: 0;
      padding: 12px;
    }

    .quote-save-button {
      flex: 1;
      min-width: 0;
    }

    .form-field.wide { grid-column: auto; }

    .modal-actions { flex-wrap: wrap; }

    .modal-primary { flex-basis: 100%; }

    .modal-secondary, .delete-button { flex: 1; }
  }
`;
