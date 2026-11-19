-- Sunday-Saturday staff timecards: private, auditable and enforced in PostgreSQL.
CREATE TABLE IF NOT EXISTS public.time_clock_segments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.profiles(id),
 kind text NOT NULL CHECK(kind IN ('work','break')),
 started_at timestamptz NOT NULL,
 ended_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT dp_clock_segment_order CHECK(ended_at IS NULL OR (ended_at>started_at AND ended_at<=started_at+interval '24 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS dp_one_open_time_segment ON public.time_clock_segments(employee_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS dp_time_segments_employee_start ON public.time_clock_segments(employee_id,started_at DESC);
CREATE TABLE IF NOT EXISTS public.time_clock_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.profiles(id),
 segment_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('add','edit','remove')),
 old_record jsonb,
 new_record jsonb,
 reason text NOT NULL CHECK(length(btrim(reason))>=3),
 corrected_by uuid NOT NULL REFERENCES public.profiles(id),
 corrected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dp_time_clock_adjustments_employee ON public.time_clock_adjustments(employee_id,corrected_at DESC);
ALTER TABLE public.time_clock_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_clock_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dp_time_segments_read ON public.time_clock_segments;
CREATE POLICY dp_time_segments_read ON public.time_clock_segments FOR SELECT TO authenticated
USING (employee_id=(select auth.uid()) OR (select auth.uid())='17b37a5d-1774-46fe-ae3a-b3ce76671e02'::uuid);
DROP POLICY IF EXISTS dp_time_adjustments_owner_read ON public.time_clock_adjustments;
CREATE POLICY dp_time_adjustments_owner_read ON public.time_clock_adjustments FOR SELECT TO authenticated
USING ((select auth.uid())='17b37a5d-1774-46fe-ae3a-b3ce76671e02'::uuid);
REVOKE ALL ON public.time_clock_segments,public.time_clock_adjustments FROM anon,PUBLIC;
GRANT SELECT ON public.time_clock_segments,public.time_clock_adjustments TO authenticated;

CREATE OR REPLACE FUNCTION public.dp_time_clock_action(p_action text)
 RETURNS time_clock_segments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid:=auth.uid();
  v_current public.time_clock_segments%ROWTYPE;
  v_new public.time_clock_segments%ROWTYPE;
  v_time timestamptz:=clock_timestamp();
BEGIN
  IF v_user IS NULL OR v_user NOT IN (
    '1571764c-5bdd-4910-b8a1-fbf8ca904ec0'::uuid,
    '43cbb740-7489-4299-907c-ec5b9886f1a2'::uuid
  ) THEN RAISE EXCEPTION 'This time clock is available only to authorized employees'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=v_user AND active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inactive employee account'; END IF;
  SELECT * INTO v_current FROM public.time_clock_segments
   WHERE employee_id=v_user AND ended_at IS NULL FOR UPDATE;
  IF p_action='in' THEN
    IF v_current.id IS NOT NULL THEN RAISE EXCEPTION 'Already clocked in or on a break'; END IF;
    INSERT INTO public.time_clock_segments(employee_id,kind,started_at)
     VALUES(v_user,'work',v_time) RETURNING * INTO v_new;
  ELSIF p_action='break' THEN
    IF v_current.id IS NULL OR v_current.kind<>'work' THEN RAISE EXCEPTION 'Clock in before starting a break'; END IF;
    UPDATE public.time_clock_segments SET ended_at=v_time WHERE id=v_current.id;
    INSERT INTO public.time_clock_segments(employee_id,kind,started_at)
     VALUES(v_user,'break',v_time) RETURNING * INTO v_new;
  ELSIF p_action='return' THEN
    IF v_current.id IS NULL OR v_current.kind<>'break' THEN RAISE EXCEPTION 'No active break to return from'; END IF;
    UPDATE public.time_clock_segments SET ended_at=v_time WHERE id=v_current.id;
    INSERT INTO public.time_clock_segments(employee_id,kind,started_at)
     VALUES(v_user,'work',v_time) RETURNING * INTO v_new;
  ELSIF p_action='out' THEN
    IF v_current.id IS NULL THEN RAISE EXCEPTION 'No active shift to clock out of'; END IF;
    UPDATE public.time_clock_segments SET ended_at=v_time WHERE id=v_current.id RETURNING * INTO v_new;
  ELSE
    RAISE EXCEPTION 'Invalid clock action';
  END IF;
  RETURN v_new;
END $function$
;

CREATE OR REPLACE FUNCTION public.dp_time_clock_adjust(p_action text, p_employee_id uuid, p_segment_id uuid, p_kind text, p_start timestamp with time zone, p_end timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_old public.time_clock_segments%ROWTYPE;
  v_new public.time_clock_segments%ROWTYPE;
  v_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_kind text;
BEGIN
  IF v_actor IS DISTINCT FROM '17b37a5d-1774-46fe-ae3a-b3ce76671e02'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_actor AND active AND role::text='Owner')
  THEN RAISE EXCEPTION 'Only Geneva may correct timecards'; END IF;
  IF p_employee_id NOT IN (
    '1571764c-5bdd-4910-b8a1-fbf8ca904ec0'::uuid,
    '43cbb740-7489-4299-907c-ec5b9886f1a2'::uuid)
  THEN RAISE EXCEPTION 'Employee is not enabled for the time clock'; END IF;
  IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'A correction reason is required'; END IF;
  IF p_action NOT IN ('add','edit','remove') THEN RAISE EXCEPTION 'Invalid correction action'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=p_employee_id FOR UPDATE;
  IF p_action IN ('edit','remove') THEN
    SELECT * INTO v_old FROM public.time_clock_segments WHERE id=p_segment_id AND employee_id=p_employee_id FOR UPDATE;
    IF v_old.id IS NULL THEN RAISE EXCEPTION 'Timecard entry not found'; END IF;
  END IF;
  IF p_action='remove' THEN
    DELETE FROM public.time_clock_segments WHERE id=v_old.id;
    v_id:=v_old.id;
  ELSE
    v_start:=p_start;
    v_end:=p_end;
    v_kind:=p_kind;
    IF v_kind NOT IN ('work','break') OR v_start IS NULL OR (v_end IS NOT NULL AND (v_end<=v_start OR v_end>v_start+interval '24 hours'))
    THEN RAISE EXCEPTION 'Check time, duration (24h maximum) and work/break type'; END IF;
    IF v_start>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Cannot enter a future clock-in'; END IF;
    IF v_end IS NULL AND EXISTS (
      SELECT 1 FROM public.time_clock_segments
      WHERE employee_id=p_employee_id AND ended_at IS NULL AND id IS DISTINCT FROM p_segment_id
    ) THEN RAISE EXCEPTION 'Employee already has an active time segment'; END IF;
    IF EXISTS(
       SELECT 1 FROM public.time_clock_segments x WHERE x.employee_id=p_employee_id
       AND x.id IS DISTINCT FROM p_segment_id
       AND tstzrange(x.started_at,coalesce(x.ended_at,'infinity'::timestamptz),'[)')
           && tstzrange(v_start,coalesce(v_end,'infinity'::timestamptz),'[)')
    ) THEN RAISE EXCEPTION 'This adjustment overlaps another work or break period'; END IF;
    IF p_action='add' THEN
      INSERT INTO public.time_clock_segments(employee_id,kind,started_at,ended_at)
      VALUES(p_employee_id,v_kind,v_start,v_end) RETURNING * INTO v_new;
    ELSE
      UPDATE public.time_clock_segments SET kind=v_kind,started_at=v_start,ended_at=v_end
      WHERE id=v_old.id RETURNING * INTO v_new;
    END IF;
    v_id:=v_new.id;
  END IF;
  INSERT INTO public.time_clock_adjustments(employee_id,segment_id,action,old_record,new_record,reason,corrected_by)
  VALUES (p_employee_id,v_id,p_action,
    CASE WHEN p_action='add' THEN NULL ELSE to_jsonb(v_old) END,
    CASE WHEN p_action='remove' THEN NULL ELSE to_jsonb(v_new) END,
    btrim(p_reason),v_actor);
  RETURN jsonb_build_object('segment_id',v_id,'action',p_action);
END $function$
;
REVOKE ALL ON FUNCTION public.dp_time_clock_action(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dp_time_clock_adjust(text,uuid,uuid,text,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dp_time_clock_action(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dp_time_clock_adjust(text,uuid,uuid,text,timestamptz,timestamptz,text) TO authenticated;
