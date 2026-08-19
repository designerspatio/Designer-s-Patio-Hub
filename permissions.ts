export type RoleName="Owner"|"Manager"|"Assistant Manager"|"Warranty Manager"|"Shipping / Accounting"|"Administrative";
export function canManageUsers(r:RoleName){return r==="Owner"||r==="Manager";}
export function canPostDailyCash(r:RoleName){return r==="Owner"||r==="Manager"||r==="Shipping / Accounting";}
