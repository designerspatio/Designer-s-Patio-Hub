-- Save a new claim and issue its numbered replacement PO in one transaction.
create or replace function public.dp_save_warranty_claim_with_po(
 p_id uuid,p_version integer,p_data jsonb,p_actor uuid,
 p_inventory_id uuid default null,p_quantity integer default null
) returns public.warranty_claims language plpgsql security invoker set search_path='' as $$
declare saved public.warranty_claims;
begin
 saved := public.dp_save_warranty_claim(p_id,p_version,p_data,p_actor,p_inventory_id,p_quantity);
 if saved.data #>> '{po,number}' = 'CPO-AUTO' then
  update public.warranty_claims set data=jsonb_set(data,'{po,number}',to_jsonb('CPO-'||saved.claim_number::text)) where id=saved.id returning * into saved;
 end if;
 return saved;
end $$;
revoke all on function public.dp_save_warranty_claim_with_po(uuid,integer,jsonb,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.dp_save_warranty_claim_with_po(uuid,integer,jsonb,uuid,uuid,integer) to service_role;
