from pathlib import Path
p=Path("src/app/page.tsx")
s=p.read_text()
def replace_once(a,b):
 global s
 n=s.count(a)
 if n!=1:raise RuntimeError(f"Expected one matching insertion point, found {n}: {a[:80]}")
 s=s.replace(a,b,1)
replace_once('import OwnerDashboard from "./OwnerDashboard";',
             'import OwnerDashboard from "./OwnerDashboard";\nimport TimeClockPanel from "./TimeClockPanel";')
replace_once('{dashboardMode === "administrative" ? <>\n              <header className="panel-header">',
             '{dashboardMode === "administrative" ? <>\n              <TimeClockPanel supabase={supabase} userId={session.user.id} />\n              <header className="panel-header">')
replace_once('</> : dashboardMode === "warranty" ? warrantyDashboard : (dashboardMode === "sales" || dashboardMode === "owner") ? <>',
             '</> : dashboardMode === "warranty" ? <><TimeClockPanel supabase={supabase} userId={session.user.id}/>{warrantyDashboard}</> : (dashboardMode === "sales" || dashboardMode === "owner") ? <>')
replace_once('              {dashboardMode === "owner" && <OwnerDashboard',
             '              {dashboardMode === "owner" && <TimeClockPanel supabase={supabase} userId={session.user.id} owner />}\n              {dashboardMode === "owner" && <OwnerDashboard')
p.write_text(s)
print("Time clocks added to Andrew, Niyah and Geneva dashboards")
