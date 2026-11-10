create or replace function public.dp_post_daily_cash(
  p_batch_id uuid,
  p_tenders jsonb,
  p_notes text
)
returns public.daily_cash_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_batch public.daily_cash_batches%rowtype;
  v_payment_ids uuid[];
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.profiles where id = v_actor and active is true
  ) and not (v_actor is null and current_user = 'postgres') then
    raise exception 'An active staff account is required to post Daily Cash' using errcode = '42501';
  end if;

  -- Serialize batch posting with payment entry, edits, and other posting requests.
  lock table public.payments in share row exclusive mode;
  select * into strict v_batch
  from public.daily_cash_batches
  where id = p_batch_id
  for no key update;

  if v_batch.status = 'Posted' then
    return v_batch;
  end if;
  if v_batch.status <> 'Open' then
    raise exception 'Only open Daily Cash batches can be posted';
  end if;

  select array_agg(p.id) into v_payment_ids
  from public.payments p
  where p.payment_date = v_batch.business_date
    and not exists (
      select 1 from public.daily_cash_batch_payments l
      join public.daily_cash_batches b on b.id = l.daily_cash_batch_id
      where l.payment_id = p.id and b.status = 'Posted'
    );

  if v_payment_ids is null then
    raise exception 'No customer payments are available to post for this date';
  end if;

  update public.payments
  set posted = true, posted_at = v_now, posted_by = v_actor, updated_at = v_now
  where id = any(v_payment_ids) and posted is distinct from true;

  -- Older versions linked payments to drafts during refresh. Move those links
  -- into the batch being posted and clear any stale links on this draft.
  delete from public.daily_cash_batch_payments
  where daily_cash_batch_id = p_batch_id and not (payment_id = any(v_payment_ids));
  insert into public.daily_cash_batch_payments (daily_cash_batch_id, payment_id)
  select p_batch_id, id from unnest(v_payment_ids) as ids(id)
  on conflict (payment_id) do update
    set daily_cash_batch_id = excluded.daily_cash_batch_id
    where daily_cash_batch_payments.daily_cash_batch_id <> excluded.daily_cash_batch_id;

  with totals as (
    select payment_method, sum(amount) as amount
    from public.payments
    where id = any(v_payment_ids)
    group by payment_method
  ), methods as (
    select unnest(array['Cash','Wire','Check','Visa/Mastercard','Discover','Amex']) as payment_method
    union select payment_method from totals
  ), amounts as (
    select m.payment_method, coalesce(t.amount, 0) as system_amount,
      coalesce(d.actual_amount, t.amount, 0) as actual_amount,
      nullif(trim(d.notes), '') as notes
    from methods m
    left join totals t using (payment_method)
    left join jsonb_to_recordset(p_tenders) as d(payment_method text, actual_amount numeric, notes text)
      using (payment_method)
  )
  insert into public.daily_cash_tender_totals (
    daily_cash_batch_id, payment_method, system_amount, actual_amount, variance_amount, notes, updated_at
  )
  select p_batch_id, payment_method, system_amount, actual_amount, actual_amount - system_amount, notes, v_now
  from amounts
  on conflict (daily_cash_batch_id, payment_method) do update
    set system_amount = excluded.system_amount, actual_amount = excluded.actual_amount,
      variance_amount = excluded.variance_amount, notes = excluded.notes, updated_at = excluded.updated_at;

  update public.daily_cash_batches
  set status = 'Posted', posted_at = v_now, posted_by = v_actor, updated_at = v_now,
      notes = nullif(trim(p_notes), '')
  where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

revoke all on function public.dp_post_daily_cash(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.dp_post_daily_cash(uuid, jsonb, text) to authenticated;
