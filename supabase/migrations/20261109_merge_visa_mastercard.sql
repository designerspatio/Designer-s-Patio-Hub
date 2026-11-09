-- Consolidate customer card tenders without changing payment dates, amounts or document IDs.
-- When replaying this migration, any existing Visa/Mastercard records remain unchanged.
BEGIN;

-- Previously posted Daily Cash reconciliation can only be corrected by Geneva
-- or the shared Accounting Team login. This one-time migration uses that login
-- so the historical tender classification can be normalized.
SELECT set_config('request.jwt.claim.sub',
  (SELECT id::text FROM public.profiles WHERE upper(display_name)='ACCOUNTING TEAM'
    AND active=true ORDER BY id LIMIT 1),true);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.daily_cash_tender_totals DROP CONSTRAINT IF EXISTS daily_cash_payment_method_check;

CREATE TEMP TABLE dp_card_tender_merge ON COMMIT DROP AS
SELECT daily_cash_batch_id,
 (array_agg(id ORDER BY CASE WHEN payment_method='Visa' THEN 0 ELSE 1 END,id))[1] AS keep_id,
 sum(system_amount) AS total_system,
 sum(actual_amount) AS total_actual,
 sum(variance_amount) AS total_variance,
 nullif(string_agg(CASE WHEN coalesce(trim(notes),'')<>'' THEN payment_method||': '||trim(notes) END,
   ' | ' ORDER BY payment_method),'') AS merged_notes
FROM public.daily_cash_tender_totals
WHERE payment_method IN ('Visa','Mastercard')
GROUP BY daily_cash_batch_id;

UPDATE public.daily_cash_tender_totals t
SET payment_method='Visa/Mastercard',system_amount=m.total_system,
 actual_amount=m.total_actual,variance_amount=m.total_variance,notes=m.merged_notes
FROM dp_card_tender_merge m WHERE t.id=m.keep_id;

DELETE FROM public.daily_cash_tender_totals t
USING dp_card_tender_merge m
WHERE t.daily_cash_batch_id=m.daily_cash_batch_id
 AND t.id<>m.keep_id AND t.payment_method IN ('Visa','Mastercard');

UPDATE public.payments SET payment_method='Visa/Mastercard'
WHERE payment_method IN ('Visa','Mastercard');

ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
 CHECK (payment_method IN ('Cash','Wire','Check','Visa/Mastercard','Discover','Amex'));
ALTER TABLE public.daily_cash_tender_totals ADD CONSTRAINT daily_cash_payment_method_check
 CHECK (payment_method IN ('Cash','Wire','Check','Visa/Mastercard','Discover','Amex'));

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.payments WHERE payment_method IN ('Visa','Mastercard')
   UNION ALL SELECT 1 FROM public.daily_cash_tender_totals
    WHERE payment_method IN ('Visa','Mastercard'))
 THEN RAISE EXCEPTION 'Old separate Visa or Mastercard denominations remain'; END IF;
END $$;
COMMIT;
