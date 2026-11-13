create table public.claim_vendor_credits (
 id uuid primary key default gen_random_uuid(),claim_id uuid not null references public.warranty_claims(id),
 manufacturer_id uuid not null references public.manufacturers(id),reference text not null,
 amount numeric(12,2) not null check(amount>0),credit_date date not null,notes text,
 request_id uuid not null unique,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid references public.profiles(id)
);
create unique index claim_vendor_credit_memo_unique on public.claim_vendor_credits(manufacturer_id,lower(btrim(reference))) where voided_at is null;
create index claim_vendor_credits_claim_idx on public.claim_vendor_credits(claim_id);
alter table public.claim_vendor_credits enable row level security;
revoke all on public.claim_vendor_credits from anon,authenticated;
grant all on public.claim_vendor_credits to service_role;
alter table public.vendor_payments add column claim_credit_id uuid references public.claim_vendor_credits(id);
create index vendor_payments_claim_credit_idx on public.vendor_payments(claim_credit_id) where claim_credit_id is not null;
create table public.claim_vendor_credit_applications (
 id uuid primary key default gen_random_uuid(),credit_id uuid not null references public.claim_vendor_credits(id),
 vendor_invoice_id uuid not null references public.vendor_invoices(id),payment_id uuid not null unique,
 amount numeric(12,2) not null check(amount>0),request_id uuid not null unique,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 reversed_at timestamptz,reversed_by uuid references public.profiles(id)
);
create index claim_credit_applications_credit_idx on public.claim_vendor_credit_applications(credit_id);
create index claim_credit_applications_invoice_idx on public.claim_vendor_credit_applications(vendor_invoice_id);
alter table public.claim_vendor_credit_applications enable row level security;
revoke all on public.claim_vendor_credit_applications from anon,authenticated;
grant all on public.claim_vendor_credit_applications to service_role;

create function public.dp_guard_claim_credit_payment() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' and ((tg_op<>'INSERT' and old.claim_credit_id is not null) or (tg_op<>'DELETE' and new.claim_credit_id is not null)) then
  raise exception 'Manage this account-credit application from its warranty claim';
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.dp_guard_claim_credit_payment() from public,anon,authenticated;
create trigger dp_guard_claim_credit_payment before insert or update or delete on public.vendor_payments
 for each row execute function public.dp_guard_claim_credit_payment();

create function public.dp_claim_vendor_credit_action(p_claim_id uuid,p_actor uuid,p_action text,p_input jsonb)
returns public.warranty_claims language plpgsql security invoker set search_path='' as $$
declare claim public.warranty_claims; credit public.claim_vendor_credits; app public.claim_vendor_credit_applications;
 invoice public.vendor_invoices; amount numeric; used numeric; paid numeric; payment uuid; credit_id uuid; summary jsonb; actor_name text;
begin
 select display_name into actor_name from public.profiles where id=p_actor and active and role::text in ('Owner','Manager','Assistant Manager','Warranty Manager');
 if not found then raise exception 'Claims permission denied'; end if;
 select * into claim from public.warranty_claims where id=p_claim_id for update;
 if not found then raise exception 'Claim not found'; end if;
 if p_action='create_credit' then
  select * into credit from public.claim_vendor_credits where request_id=(p_input->>'requestId')::uuid;
  if found then if credit.claim_id<>p_claim_id then raise exception 'Invalid credit request'; end if; return claim; end if;
  amount=(p_input->>'amount')::numeric;
  if amount is null or amount<=0 or amount>100000000 or amount<>round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter a positive credit amount with at most two decimal places'; end if;
  if length(trim(coalesce(p_input->>'reference','')))=0 then raise exception 'Enter the manufacturer credit memo reference'; end if;
  insert into public.claim_vendor_credits(claim_id,manufacturer_id,reference,amount,credit_date,notes,request_id,created_by)
   values(p_claim_id,(claim.data->>'manufacturerId')::uuid,trim(p_input->>'reference'),amount,(p_input->>'date')::date,nullif(trim(p_input->>'notes'),''),(p_input->>'requestId')::uuid,p_actor) returning * into credit;
 else
  if p_action='reverse_credit' then
   select * into app from public.claim_vendor_credit_applications where id=(p_input->>'applicationId')::uuid;
   if not found then raise exception 'Credit application not found'; end if; credit_id=app.credit_id;
  else credit_id=(p_input->>'creditId')::uuid; end if;
  select * into credit from public.claim_vendor_credits where id=credit_id and claim_id=p_claim_id for update;
  if not found then raise exception 'Credit does not belong to this claim'; end if;
  select coalesce(sum(a.amount),0) into used from public.claim_vendor_credit_applications a where a.credit_id=credit.id and a.reversed_at is null;
  if p_action='apply_credit' then
   select * into app from public.claim_vendor_credit_applications where request_id=(p_input->>'requestId')::uuid;
   if found then if app.credit_id<>credit.id then raise exception 'Invalid credit application request'; end if; return claim; end if;
   if credit.voided_at is not null then raise exception 'This credit has been voided'; end if;
   amount=(p_input->>'amount')::numeric;
   if amount is null or amount<=0 or amount>credit.amount-used or amount<>round(amount,2) or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Credit application exceeds available credit or has an invalid amount'; end if;
   select * into invoice from public.vendor_invoices where id=(p_input->>'invoiceId')::uuid for update;
   if not found or invoice.manufacturer_id is distinct from credit.manufacturer_id then raise exception 'Choose an invoice from this claim manufacturer'; end if;
   if invoice.status='Void' then raise exception 'Cannot apply credits to a void invoice'; end if;
   select coalesce(sum(v.amount),0) into paid from public.vendor_payments v where v.vendor_invoice_id=invoice.id;
   if amount>invoice.total_amount-paid then raise exception 'Credit application exceeds the outstanding invoice balance'; end if;
   insert into public.vendor_payments(vendor_invoice_id,manufacturer_id,payment_date,amount,payment_method,reference,notes,created_by,claim_credit_id)
    values(invoice.id,credit.manufacturer_id,current_date,amount,'Account Credit',credit.reference,'Warranty claim CL-'||claim.claim_number||' account credit; non-cash',p_actor,credit.id) returning id into payment;
   insert into public.claim_vendor_credit_applications(credit_id,vendor_invoice_id,payment_id,amount,request_id,created_by)
    values(credit.id,invoice.id,payment,amount,(p_input->>'requestId')::uuid,p_actor);
  elsif p_action='reverse_credit' then
   select * into app from public.claim_vendor_credit_applications where id=app.id for update;
   if app.reversed_at is not null then return claim; end if;
   perform 1 from public.vendor_invoices where id=app.vendor_invoice_id for update;
   delete from public.vendor_payments where id=app.payment_id and claim_credit_id=credit.id;
   update public.claim_vendor_credit_applications set reversed_at=clock_timestamp(),reversed_by=p_actor where id=app.id;
  elsif p_action='void_credit' then
   if used>0 then raise exception 'Reverse credit applications before voiding the credit'; end if;
   update public.claim_vendor_credits set voided_at=clock_timestamp(),voided_by=p_actor where id=credit.id;
  else raise exception 'Unknown credit action'; end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'reference',c.reference,'amount',c.amount,'applied',coalesce(a.used,0),'remaining',case when c.voided_at is not null then 0 else c.amount-coalesce(a.used,0) end,'voided',c.voided_at is not null)),'[]'::jsonb) into summary
 from public.claim_vendor_credits c left join lateral(select sum(x.amount) as used from public.claim_vendor_credit_applications x where x.credit_id=c.id and x.reversed_at is null) a on true where c.claim_id=p_claim_id;
 update public.warranty_claims set data=jsonb_set(data,'{accountCredits}',summary)||jsonb_build_object('history',coalesce(data->'history','[]'::jsonb)||jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'by',actor_name,'action',p_action))),version=version+1,updated_at=clock_timestamp(),sync_error=null
 where id=p_claim_id returning * into claim;
 return claim;
end $$;
revoke all on function public.dp_claim_vendor_credit_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.dp_claim_vendor_credit_action(uuid,uuid,text,jsonb) to service_role;
