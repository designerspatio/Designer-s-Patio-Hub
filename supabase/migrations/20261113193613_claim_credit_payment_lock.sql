-- Cash payments and account-credit applications share an invoice lock so two
-- simultaneous settlements cannot both consume the same outstanding balance.
create or replace function public.validate_vendor_payment()
returns trigger language plpgsql security invoker set search_path='' as $$
declare invoice_total numeric(12,2); already_paid numeric(12,2); invoice_status text; maker uuid;
begin
 select total_amount,status,manufacturer_id into invoice_total,invoice_status,maker
 from public.vendor_invoices where id=new.vendor_invoice_id for update;
 if not found then raise exception 'Vendor invoice not found'; end if;
 if invoice_status='Void' then raise exception 'Payments cannot be recorded against a Void invoice'; end if;
 if tg_op='UPDATE' then
  select coalesce(sum(p.amount),0) into already_paid from public.vendor_payments p where p.vendor_invoice_id=new.vendor_invoice_id and p.id<>old.id;
 else
  select coalesce(sum(p.amount),0) into already_paid from public.vendor_payments p where p.vendor_invoice_id=new.vendor_invoice_id;
 end if;
 if already_paid+new.amount>invoice_total then
  raise exception 'Vendor payment exceeds invoice balance. Invoice total: %, already paid: %, attempted payment: %',invoice_total,already_paid,new.amount;
 end if;
 new.manufacturer_id=maker;
 return new;
end $$;
