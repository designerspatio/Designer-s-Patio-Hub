export type SalesTask = {
  id: string;
  title: string;
  clientId: string;
  dueDate: string;
  priority: "normal" | "high";
  completedAt: string | null;
  createdAt: string;
};
export type CrmWorkspace = {
  version: number;
  tasks: SalesTask[];
  note: string;
  pinnedClientIds: string[];
};
export const emptyWorkspace = (): CrmWorkspace => ({ version: 0, tasks: [], note: "", pinnedClientIds: [] });
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function dateAfter(days: number, from = new Date()) {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return localDate(date);
}
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function taskGroup(task: SalesTask, today: string) {
  if (task.completedAt) return "completed";
  if (!task.dueDate) return "undated";
  if (task.dueDate < today) return "overdue";
  return task.dueDate === today ? "today" : "upcoming";
}
export function sortTasks(tasks: SalesTask[]) {
  return [...tasks].sort((a, b) =>
    Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) ||
    (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
    Number(b.priority === "high") - Number(a.priority === "high") ||
    a.createdAt.localeCompare(b.createdAt));
}
export function parseWorkspace(value: unknown): CrmWorkspace {
  const w = value as CrmWorkspace;
  const shortText = (s: unknown, max: number) => typeof s === "string" && s.length <= max;
  const timestamp = (s: unknown) => typeof s === "string" && s.length <= 40 && Number.isFinite(Date.parse(s));
  if (!w || !Number.isSafeInteger(w.version) || w.version < 0 || w.version > 999999999998 ||
    !shortText(w.note, 20000) || !Array.isArray(w.tasks) || w.tasks.length > 300 ||
    !Array.isArray(w.pinnedClientIds) || w.pinnedClientIds.length > 24 ||
    !w.pinnedClientIds.every(id => shortText(id, 80) && id.length > 0)) throw new Error("Invalid workspace. Limit: 300 tasks, 24 pinned clients and 20,000 note characters.");
  const ids = new Set<string>();
  const tasks = w.tasks.map(t => {
    if (!t || !shortText(t.id, 80) || !t.id || ids.has(t.id) || !shortText(t.title, 240) || !t.title.trim() ||
      !shortText(t.clientId, 80) || !(t.dueDate === "" || isDate(t.dueDate)) ||
      !["normal", "high"].includes(t.priority) || !timestamp(t.createdAt) ||
      !(t.completedAt === null || timestamp(t.completedAt))) throw new Error("Invalid task. Check its title and due date.");
    ids.add(t.id);
    return { id: t.id, title: t.title.trim(), clientId: t.clientId, dueDate: t.dueDate, priority: t.priority,
      completedAt: t.completedAt, createdAt: t.createdAt };
  });
  return { version: w.version, tasks, note: w.note, pinnedClientIds: [...new Set(w.pinnedClientIds)] };
}
