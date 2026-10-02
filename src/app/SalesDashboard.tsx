"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateAfter, localDate, parseWorkspace, sortTasks, taskGroup, type CrmWorkspace, type SalesTask } from "./crmWorkspace";
import styles from "./SalesDashboard.module.css";

type Contact = { id: string; name: string; email: string | null; phone: string | null; location: string };
type Quote = { id: string; quote_number: number; client_id: string; status: string; approved: boolean;
  converted_sales_order_id: string | null; expiration_date: string | null; quote_date: string; updated_at: string };
type Props = {
  userId: string; firstName: string; supabase: SupabaseClient | null;
  clients: Contact[]; allClients: Contact[]; quotes: Quote[]; loading: boolean; scopeLabel: string;
  onDirtyChange?: (dirty: boolean) => void;
  onClient: (id: string) => void; onQuote: (id: string) => void;
  onNewClient: () => void; onNewQuote: () => void; onScan: () => void; onClients: () => void; onQuotes: () => void;
};
type TaskFilter = "open" | "today" | "upcoming" | "completed";
const blankTask = () => ({ title: "", clientId: "", dueDate: localDate(), priority: "normal" as SalesTask["priority"] });
function dateLabel(date: string) {
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No due date";
}
export default function SalesDashboard(props: Props) {
  const { userId, supabase, clients, allClients, quotes, loading } = props;
  const [workspace, setWorkspace] = useState<CrmWorkspace | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [draft, setDraft] = useState(blankTask);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [today, setToday] = useState(localDate);
  const [pinChoice, setPinChoice] = useState("");
  const busy = useRef(false);
  const mounted = useRef(true);
  const taskInput = useRef<HTMLInputElement>(null);
  const lastSaved = useRef<CrmWorkspace | null>(null);

  async function request(method: "GET" | "PUT", body?: CrmWorkspace) {
    const session = await supabase?.auth.getSession();
    const authSession = session?.data.session;
    if (!authSession || authSession.user.id !== userId) throw new Error("Please sign in again to load your personal workspace.");
    const response = await fetch("/api/workspace", {
      method, cache: "no-store", headers: { Authorization: `Bearer ${authSession.access_token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to reach your workspace. Please retry.");
    return parseWorkspace(payload.workspace);
  }
  async function load() {
    if (busy.current) return;
    busy.current = true; setLoadingWorkspace(true); setError("");
    try {
      const loaded = await request("GET");
      if (!mounted.current) return;
      setWorkspace(loaded); lastSaved.current = loaded; setDirty(false); setSavedAt("");
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Unable to load workspace."); }
    finally { busy.current = false; if (mounted.current) setLoadingWorkspace(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
    // The parent keys this component by authenticated user ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const refreshDate = () => setToday(localDate());
    const timer = window.setInterval(refreshDate, 60000);
    window.addEventListener("focus", refreshDate);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshDate); };
  }, []);
  useEffect(() => { props.onDirtyChange?.(dirty); }, [dirty, props.onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(next: CrmWorkspace) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setDirty(true); setError(""); setWorkspace(next);
    try {
      const saved = await request("PUT", next);
      if (!mounted.current) return;
      setWorkspace(saved); lastSaved.current = saved; setDirty(false);
      setSavedAt(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Unable to save. Your changes are still on screen."); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  }
  const contactById = useMemo(() => new Map(allClients.map(c => [c.id, c])), [allClients]);
  const tasks = workspace?.tasks || [];
  const due = tasks.filter(t => !t.completedAt && t.dueDate && t.dueDate <= today);
  const upcoming = tasks.filter(t => !t.completedAt && t.dueDate > today && t.dueDate <= dateAfter(7));
  const shownTasks = sortTasks(tasks).filter(t => {
    const group = taskGroup(t, today);
    return filter === "completed" ? group === "completed" : filter === "today" ? ["overdue", "today"].includes(group)
      : filter === "upcoming" ? group === "upcoming" : group !== "completed";
  });
  const followUps = useMemo(() => quotes.filter(q => !q.approved && !q.converted_sales_order_id && !["Archived", "Approved", "Converted", "Cancelled", "Canceled", "Declined"].includes(q.status))
    .map(quote => ({ quote, expiry: quote.expiration_date?.slice(0, 10) || "", lastUpdate: (quote.updated_at || quote.quote_date).slice(0, 10) }))
    .filter(q => (q.expiry && q.expiry <= dateAfter(7)) || q.lastUpdate <= dateAfter(-7))
    .sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999") || a.lastUpdate.localeCompare(b.lastUpdate)), [quotes, today]);
  const pinned = workspace?.pinnedClientIds || [];
  const shownClients = clients.filter(c => search.trim() ? `${c.name} ${c.email || ""} ${c.location}`.toLowerCase().includes(search.trim().toLowerCase()) : pinned.includes(c.id)).slice(0, 8);
  const disabled = saving || loadingWorkspace || !workspace;
  function editTask(task: SalesTask) {
    setEditingId(task.id); setDraft({ title: task.title, clientId: task.clientId, dueDate: task.dueDate, priority: task.priority });
    taskInput.current?.focus();
  }
  function followUpTask(quote: Quote) {
    setEditingId(null); setDraft({ title: `Follow up on quote #${quote.quote_number}`, clientId: quote.client_id, dueDate: today, priority: "normal" });
    taskInput.current?.focus(); taskInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function togglePin(id: string) {
    if (!workspace || disabled) return;
    void save({ ...workspace, pinnedClientIds: pinned.includes(id) ? pinned.filter(p => p !== id) : [...pinned, id] });
    setPinChoice("");
  }
  return <div className={styles.dashboard}>
    <header className={styles.welcome}>
      <div><div className={styles.eyebrow}>YOUR RELATIONSHIP DESK</div><h1>Good to see you, {props.firstName}.</h1>
        <p>A little organization. A timely follow-up. A stronger client relationship.</p></div>
      <div className={styles.date}>{new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}<span>Make room for your next great conversation.</span></div>
    </header>
    <div className={styles.quickActions} aria-label="Sales shortcuts">
      <button className={styles.primary} onClick={props.onNewQuote}>＋ New quote</button>
      <button onClick={props.onNewClient}>＋ New client</button><button onClick={props.onScan}>Scan a badge</button><button onClick={props.onClients}>Find a client →</button>
    </div>
    <div className={styles.focusStrip}>
      <button onClick={() => setFilter("today")}><span>YOUR FOLLOW-THROUGHS</span><strong>{workspace ? due.length : "—"} <small>due now</small></strong><p>{due.filter(t => t.dueDate < today).length} overdue · keep the conversation moving</p></button>
      <button onClick={() => setFilter("upcoming")}><span>LOOKING AHEAD</span><strong>{workspace ? upcoming.length : "—"} <small>in the next 7 days</small></strong><p>Plan calls, samples and client check-ins</p></button>
      <button onClick={() => document.getElementById("crm-follow-ups")?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>{props.scopeLabel.toUpperCase()}</span><strong>{loading ? "—" : followUps.length} <small>quotes to revisit</small></strong><p>Based on quote dates, not contact history</p></button>
    </div>
    <div className={styles.saveBar}>
      <span>Tasks, pins and notes are personal to your login.</span>
      <span role="status">{saving ? "Saving to your account…" : loadingWorkspace ? "Loading your workspace…" : dirty ? "Unsaved changes" : workspace ? savedAt ? `Saved at ${savedAt}` : "Saved to your account" : "Workspace unavailable"}</span>
    </div>
    {error && <div className={styles.error} role="alert"><div>{error}</div><div className={styles.inlineActions}>
      {workspace && dirty && <button disabled={saving} onClick={() => void save(workspace)}>Retry save</button>}
      {workspace && dirty && <button onClick={() => {
        const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "my-workspace-unsaved.json"; link.click(); URL.revokeObjectURL(url);
      }}>Download unsaved copy</button>}
      <button disabled={saving || loadingWorkspace} onClick={() => { if (!dirty || window.confirm("Load the latest saved workspace? Unsaved changes will be replaced. You can download a copy first.")) void load(); }}>Load latest</button>
    </div></div>}
    <div className={styles.grid}>
      <section className={`${styles.card} ${styles.tasks}`} aria-labelledby="crm-tasks-heading">
        <div className={styles.cardHeading}><div><div className={styles.eyebrow}>ONE NEXT STEP AT A TIME</div><h2 id="crm-tasks-heading">My task list</h2></div><span className={styles.badge}>{tasks.filter(t => !t.completedAt).length} open</span></div>
        <form className={styles.taskForm} onSubmit={event => {
          event.preventDefault(); if (!workspace || disabled || !draft.title.trim()) return;
          if (!editingId && tasks.length >= 300) { setError("You have 300 tasks. Delete older completed tasks to make room."); return; }
          const nextTask: SalesTask = { ...draft, title: draft.title.trim(), id: editingId || crypto.randomUUID(), completedAt: tasks.find(t => t.id === editingId)?.completedAt || null, createdAt: tasks.find(t => t.id === editingId)?.createdAt || new Date().toISOString() };
          void save({ ...workspace, tasks: editingId ? tasks.map(t => t.id === editingId ? nextTask : t) : [...tasks, nextTask] });
          setDraft(blankTask()); setEditingId(null);
        }}>
          <label className={styles.fullWidth}>Next step<input ref={taskInput} value={draft.title} maxLength={240} required disabled={disabled} placeholder="Call a designer, send fabric options, check delivery…" onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Client<select disabled={disabled} value={draft.clientId} onChange={e => setDraft({ ...draft, clientId: e.target.value })}><option value="">General task</option>{allClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}{draft.clientId && !contactById.has(draft.clientId) && <option value={draft.clientId}>Client unavailable</option>}</select></label>
          <label>Due date<input type="date" disabled={disabled} value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} /></label>
          <label>Priority<select disabled={disabled} value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as SalesTask["priority"] })}><option value="normal">Normal</option><option value="high">High</option></select></label>
          <div className={styles.inlineActions}><button className={styles.primary} disabled={disabled || !draft.title.trim()} type="submit">{editingId ? "Update task" : "Add task"}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setDraft(blankTask()); }}>Cancel edit</button>}</div>
        </form>
        <div className={styles.tabs} role="group" aria-label="Task filters">{([ ["open", "All open"], ["today", "Due now"], ["upcoming", "Upcoming"], ["completed", "Completed"] ] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <div className={styles.taskList}>
          {loadingWorkspace ? <p className={styles.empty}>Loading your tasks…</p> : !workspace ? <p className={styles.empty}>Load your workspace to manage tasks.</p> : !shownTasks.length ? <p className={styles.empty}>{filter === "completed" ? "Completed tasks will stay here for reference." : "Nothing on this list. Add your next client follow-up above."}</p> : shownTasks.map(task => {
            const client = contactById.get(task.clientId); const group = taskGroup(task, today);
            return <div key={task.id} className={`${styles.taskRow} ${task.completedAt ? styles.completed : ""}`}>
              <input type="checkbox" aria-label={`Complete ${task.title}`} checked={Boolean(task.completedAt)} disabled={disabled} onChange={() => void save({ ...workspace!, tasks: tasks.map(t => t.id === task.id ? { ...t, completedAt: t.completedAt ? null : new Date().toISOString() } : t) })} />
              <div className={styles.taskCopy}><strong>{task.title}</strong><div className={styles.taskMeta}>
                {client ? <button onClick={() => props.onClient(client.id)}>{client.name}</button> : <span>{task.clientId ? "Client unavailable" : "General task"}</span>}
                <span className={group === "overdue" ? styles.overdue : ""}>{group === "overdue" ? "Overdue · " : ""}{dateLabel(task.dueDate)}</span>{task.priority === "high" && <span className={styles.priority}>High priority</span>}
              </div></div>
              <div className={styles.rowActions}><button disabled={disabled} aria-label={`Edit ${task.title}`} onClick={() => editTask(task)}>Edit</button><button disabled={disabled} aria-label={`Delete ${task.title}`} onClick={() => { if (window.confirm(`Delete “${task.title}”?`)) { void save({ ...workspace!, tasks: tasks.filter(t => t.id !== task.id) }); if (editingId === task.id) { setEditingId(null); setDraft(blankTask()); } } }}>×</button></div>
            </div>;
          })}
        </div>
      </section>
      <section className={`${styles.card} ${styles.notepad}`} aria-labelledby="crm-notes-heading">
        <div className={styles.cardHeading}><div><div className={styles.eyebrow}>A PLACE TO THINK</div><h2 id="crm-notes-heading">My notepad</h2></div><span className={styles.badge}>Personal</span></div>
        <p className={styles.help}>Ideas, talking points and reminders for your next conversation.</p>
        <label className={styles.noteLabel}>Your notes<textarea aria-label="Your personal notepad" maxLength={20000} disabled={disabled} value={workspace?.note || ""} placeholder={'Things to remember…\n\n• Fabric samples to pull\n• Questions for a vendor\n• Ideas for a client’s space'} onChange={e => { if (workspace) { const next = { ...workspace, note: e.target.value }; setWorkspace(next); setDirty(JSON.stringify(next) !== JSON.stringify(lastSaved.current)); } }} /></label>
        <div className={styles.noteFooter}><span>{(workspace?.note.length || 0).toLocaleString()} / 20,000</span><button className={styles.primary} disabled={disabled || !dirty} onClick={() => workspace && void save(workspace)}>{saving ? "Saving…" : "Save notepad"}</button></div>
      </section>
      <section className={styles.card} aria-labelledby="crm-follow-ups" id="crm-follow-ups-panel">
        <div className={styles.cardHeading}><div><div className={styles.eyebrow}>{props.scopeLabel.toUpperCase()}</div><h2 id="crm-follow-ups">Conversation starters</h2></div><button onClick={props.onQuotes}>All quotes →</button></div>
        <p className={styles.help}>Unconverted quotes nearing their expiration date or untouched for at least a week. Review before reaching out.</p>
        {loading ? <p className={styles.empty}>Loading quotes…</p> : !followUps.length ? <p className={styles.empty}>No quotes need a date-based follow-up right now.</p> : followUps.slice(0, 6).map(({ quote, expiry, lastUpdate }) => <div key={quote.id} className={styles.followUp}>
          <div><button className={styles.contactName} onClick={() => props.onQuote(quote.id)}>{contactById.get(quote.client_id)?.name || "Client unavailable"} <span>#{quote.quote_number}</span></button><p>{expiry && expiry <= dateAfter(7) ? `${expiry < today ? "Expired" : "Expires"} ${dateLabel(expiry)}` : `Last quote update ${dateLabel(lastUpdate)}`} · {quote.status}</p></div>
          <button disabled={disabled} onClick={() => followUpTask(quote)}>＋ Task</button>
        </div>)}
        {followUps.length > 6 && <p className={styles.help}>Showing 6 of {followUps.length} suggestions.</p>}
      </section>
      <section className={styles.card} aria-labelledby="crm-clients-heading">
        <div className={styles.cardHeading}><div><div className={styles.eyebrow}>{props.scopeLabel.toUpperCase()}</div><h2 id="crm-clients-heading">Clients to keep close</h2></div><button onClick={props.onClients}>Directory →</button></div>
        <p className={styles.help}>Pin clients you’re working with. Search to find someone else.</p>
        <label>Find a client<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, email or location" /></label>
        <div className={styles.pinControls}><select aria-label="Choose a client to pin" disabled={disabled || pinned.length >= 24} value={pinChoice} onChange={e => setPinChoice(e.target.value)}><option value="">Choose a client to pin…</option>{clients.filter(c => !pinned.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button disabled={disabled || !pinChoice} onClick={() => togglePin(pinChoice)}>Pin</button></div>
        {loading ? <p className={styles.empty}>Loading clients…</p> : !shownClients.length ? <p className={styles.empty}>{search ? "No matching clients in this view." : "Pin a client above to keep their contact details handy in this view."}</p> : shownClients.map(client => <div className={styles.clientRow} key={client.id}>
          <div className={styles.avatar} aria-hidden="true">{client.name.slice(0, 1).toUpperCase()}</div><div className={styles.clientCopy}><button className={styles.contactName} onClick={() => props.onClient(client.id)}>{client.name}</button><span>{client.location || "Open client details"}</span><div className={styles.contactActions}>{client.email && <a href={`mailto:${client.email}`}>Email</a>}{client.phone && <a href={`tel:${client.phone.replace(/[^\d+]/g, "")}`}>Call</a>}</div></div><button aria-label={`${pinned.includes(client.id) ? "Unpin" : "Pin"} ${client.name}`} disabled={disabled || (!pinned.includes(client.id) && pinned.length >= 24)} onClick={() => togglePin(client.id)}>{pinned.includes(client.id) ? "Unpin" : "Pin"}</button>
        </div>)}
      </section>
    </div>
  </div>;
}
