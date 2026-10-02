export type RecordScope = "mine" | "all";

// This is a view filter, not authorization. Database policies still control access.
export function matchesRecordScope(
  ownerId: string | null | undefined,
  scope: RecordScope,
  currentUserId: string | undefined,
  salespersonId = "",
): boolean {
  if (!currentUserId) return false;
  if (scope === "mine") return ownerId === currentUserId;
  if (!salespersonId) return true;
  if (salespersonId === "__unassigned__") return !ownerId;
  return ownerId === salespersonId;
}
