-- Designer's Patio Hub: secured cash corrections, sales PO authorization,
-- and vendor acknowledgement expected ship dates. Applied to production 2026-11-09.
BEGIN;
ALTER TABLE public.purchase_order_acknowledgements ADD COLUMN IF NOT EXISTS expected_ship_date date;
CREATE TABLE IF NOT EXISTS public.daily_cash_correction_history (
 id uuid primary key default gen_random_uuid(),
 daily_cash_batch_id uuid not null references public.daily_cash_batches(id),
 corrected_by uuid not null references public.profiles(id),
 correction_reason text not null check(length(trim(correction_reason))>=3),
 before_state jsonb not null,
 after_state jsonb not null,
 corrected_at timestamptz not null default now()
);
ALTER TABLE public.daily_cash_correction_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_cash_correction_history FROM public,anon,authenticated;
GRANT SELECT ON public.daily_cash_correction_history TO authenticated;

CREATE OR REPLACE FUNCTION public.dp_can_correct_posted_cash()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active is true
    and p.id in (
      '17b37a5d-1774-46fe-ae3a-b3ce76671e02'::uuid,
      'a31a3c72-7f3d-4b62-a61a-04442c20c896'::uuid
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.dp_can_create_sales_po()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active is true
    and p.id in (
      '17b37a5d-1774-46fe-ae3a-b3ce76671e02'::uuid,
      '1e670fd1-6576-4d63-a8d4-d828c8a98025'::uuid
    )
  )
$function$;
REVOKE ALL ON FUNCTION public.dp_can_correct_posted_cash() FROM public,anon;
REVOKE ALL ON FUNCTION public.dp_can_create_sales_po() FROM public,anon;
GRANT EXECUTE ON FUNCTION public.dp_can_correct_posted_cash() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dp_can_create_sales_po() TO authenticated;

DROP POLICY IF EXISTS "authorized staff read daily cash corrections" ON public.daily_cash_correction_history;
CREATE POLICY "authorized staff read daily cash corrections"
ON public.daily_cash_correction_history FOR SELECT TO authenticated
USING (public.dp_can_correct_posted_cash());

CREATE OR REPLACE FUNCTION public.dp_guard_cash_correction()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare batch_status text;
begin
  if tg_table_name='daily_cash_batches' then
    if tg_op in ('UPDATE','DELETE') and lower(old.status) in ('posted','closed') 
       and not public.dp_can_correct_posted_cash() then
       raise exception 'Only Geneva or Accounting Team may correct a posted Daily Cash batch'
         using errcode='42501';
    end if;
  else
    select b.status into batch_status from public.daily_cash_batches b
    where b.id = case when tg_op='DELETE' then old.daily_cash_batch_id else new.daily_cash_batch_id end;
    if lower(coalesce(batch_status,'')) in ('posted','closed')
        and not public.dp_can_correct_posted_cash() then
        raise exception 'Only Geneva or Accounting Team may correct a posted Daily Cash batch'
          using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS dp_guard_posted_daily_cash ON public.daily_cash_batches;
CREATE TRIGGER dp_guard_posted_daily_cash BEFORE UPDATE OR DELETE
ON public.daily_cash_batches FOR EACH ROW EXECUTE FUNCTION public.dp_guard_cash_correction();
DROP TRIGGER IF EXISTS dp_guard_posted_cash_payments ON public.daily_cash_batch_payments;
CREATE TRIGGER dp_guard_posted_cash_payments BEFORE INSERT OR UPDATE OR DELETE
ON public.daily_cash_batch_payments FOR EACH ROW EXECUTE FUNCTION public.dp_guard_cash_correction();
DROP TRIGGER IF EXISTS dp_guard_posted_cash_tenders ON public.daily_cash_tender_totals;
CREATE TRIGGER dp_guard_posted_cash_tenders BEFORE INSERT OR UPDATE OR DELETE
ON public.daily_cash_tender_totals FOR EACH ROW EXECUTE FUNCTION public.dp_guard_cash_correction();

CREATE OR REPLACE FUNCTION public.dp_guard_sales_po_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.sales_order_id is not null and
    (tg_op='INSERT' or (tg_op='UPDATE' and old.sales_order_id is distinct from new.sales_order_id))
    and not public.dp_can_create_sales_po() then
    raise exception 'Only Joey or Geneva may generate a Purchase Order from a Sales Order'
      using errcode='42501';
  end if;
  return new;
end $function$;
DROP TRIGGER IF EXISTS dp_guard_sales_po_creation ON public.purchase_orders;
CREATE TRIGGER dp_guard_sales_po_creation BEFORE INSERT OR UPDATE OF sales_order_id
ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.dp_guard_sales_po_creation();

CREATE OR REPLACE FUNCTION public.dp_sync_ack_expected_ship_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.expected_ship_date is not null and
    (tg_op='INSERT' or new.expected_ship_date is distinct from old.expected_ship_date) then
   update public.purchase_orders set
     estimated_ship_date=new.expected_ship_date,
     updated_at=now()
   where id=new.purchase_order_id;
 end if;
 return new;
end $function$;
DROP TRIGGER IF EXISTS dp_sync_ack_expected_ship_date ON public.purchase_order_acknowledgements;
CREATE TRIGGER dp_sync_ack_expected_ship_date AFTER INSERT OR UPDATE OF expected_ship_date
ON public.purchase_order_acknowledgements FOR EACH ROW
EXECUTE FUNCTION public.dp_sync_ack_expected_ship_date();

CREATE OR REPLACE FUNCTION public.dp_correct_posted_daily_cash(p_batch_id uuid, p_tenders jsonb, p_notes text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid := (select auth.uid());
 v_batch public.daily_cash_batches%rowtype;
 v_before jsonb;
 v_after jsonb;
 v_tender record;
 v_sys numeric;
 v_methods int;
begin
 if v_actor is null or not public.dp_can_correct_posted_cash() then
   raise exception 'Only Geneva or Accounting Team can correct posted Daily Cash'
      using errcode='42501';
 end if;
 if length(trim(coalesce(p_reason,''))) < 3 then
   raise exception 'Please provide a meaningful correction reason';
 end if;
 if p_tenders is null or jsonb_typeof(p_tenders) <> 'array' then
   raise exception 'Tender corrections must be an array';
 end if;
 if jsonb_array_length(p_tenders) > 20 then
   raise exception 'Too many tender types in correction';
 end if;
 select * into v_batch from public.daily_cash_batches
 where id = p_batch_id for update;
 if not found or lower(v_batch.status) <> 'posted' then
   raise exception 'Only posted Daily Cash batches may be corrected here';
 end if;
 select count(*) into v_methods
 from (select distinct t.payment_method from jsonb_to_recordset(p_tenders)
       as t(payment_method text,actual_amount numeric,notes text)) x;
 if v_methods <> jsonb_array_length(p_tenders) then
   raise exception 'Duplicate tender methods are not allowed';
 end if;
 select jsonb_build_object(
   'batch_notes',v_batch.notes,
   'tenders',coalesce((select jsonb_agg(to_jsonb(t) order by t.payment_method)
    from public.daily_cash_tender_totals t where t.daily_cash_batch_id=p_batch_id),'[]'::jsonb)
 ) into v_before;
 for v_tender in select * from jsonb_to_recordset(p_tenders)
   as t(payment_method text,actual_amount numeric,notes text)
 loop
   if v_tender.payment_method is null or v_tender.payment_method = '' or
      v_tender.actual_amount is null or v_tender.actual_amount < 0 then
     raise exception 'Valid tender method and nonnegative actual amount required';
   end if;
   select coalesce(sum(p.amount),0) into v_sys
   from public.daily_cash_batch_payments bp
   join public.payments p on p.id=bp.payment_id
   where bp.daily_cash_batch_id=p_batch_id
     and p.posted=true and p.payment_method=v_tender.payment_method;
   insert into public.daily_cash_tender_totals (
    daily_cash_batch_id,payment_method,system_amount,actual_amount,
    variance_amount,notes,updated_at
   ) values (
    p_batch_id,v_tender.payment_method,v_sys,v_tender.actual_amount,
    v_tender.actual_amount-v_sys,v_tender.notes,now()
   ) on conflict (daily_cash_batch_id,payment_method)
   do update set system_amount=excluded.system_amount,
    actual_amount=excluded.actual_amount,variance_amount=excluded.variance_amount,
    notes=excluded.notes,updated_at=now();
 end loop;
 update public.daily_cash_batches set notes=nullif(trim(coalesce(p_notes,'')),''),
   updated_at=now() where id=p_batch_id;
 select jsonb_build_object(
   'batch_notes',nullif(trim(coalesce(p_notes,'')),''),
   'tenders',coalesce((select jsonb_agg(to_jsonb(t) order by t.payment_method)
    from public.daily_cash_tender_totals t where t.daily_cash_batch_id=p_batch_id),'[]'::jsonb)
 ) into v_after;
 insert into public.daily_cash_correction_history(
  daily_cash_batch_id,corrected_by,correction_reason,before_state,after_state
 ) values(p_batch_id,v_actor,trim(p_reason),v_before,v_after);
end $function$;
REVOKE ALL ON FUNCTION public.dp_correct_posted_daily_cash(uuid,jsonb,text,text)
FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dp_correct_posted_daily_cash(uuid,jsonb,text,text)
TO authenticated;

CREATE OR REPLACE VIEW public.dp_sales_order_ship_dates
WITH (security_invoker=true) AS
SELECT so.id AS sales_order_id, max(po.estimated_ship_date) AS estimated_ship_date,
count(po.id) AS purchase_order_count
FROM public.sales_orders so LEFT JOIN public.purchase_orders po ON po.sales_order_id=so.id
GROUP BY so.id;
REVOKE ALL ON public.dp_sales_order_ship_dates FROM anon;
GRANT SELECT ON public.dp_sales_order_ship_dates TO authenticated;
COMMIT;
