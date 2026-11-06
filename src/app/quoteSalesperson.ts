/** Client primary salesperson wins over the person entering a new quote. */
export function defaultQuoteSalesperson(
  assignedUserId: string | null | undefined,
  loggedInUserId: string | null | undefined,
): string {
  return assignedUserId || loggedInUserId || "";
}

/** Owners are legitimate primary salespeople, even if their main job is not sales. */
export function salespersonOptionName(person: {display_name:string;role:string}): string {
  return person.role === "Owner"
    ? `${person.display_name.split(" ")[0]} (Owner)`
    : person.display_name;
}
