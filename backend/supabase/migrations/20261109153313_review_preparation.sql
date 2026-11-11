-- Add bounded review metadata persistence to the existing service-only dispatcher.
-- No grants, tables, indexes, canonical storage, history or existing rows change.
do $migration$
declare definition text; anchor text := $anchor$ elsif p_action='entity.get' then$anchor$;
 addition text := $addition$ elsif p_action='review.prepare' then
  -- sigap:review-preparation-v1: create snapshot and batch preview atomically.
  declare
   review jsonb := p_args->'snapshot'; review_batch jsonb; existing_review jsonb; payload jsonb;
  begin
   if jsonb_typeof(p_args->'session_id') is distinct from 'string' or length(p_args->>'session_id')=0
      or jsonb_typeof(review) is distinct from 'object'
      or coalesce(review->>'snapshot_id','') !~ '^[a-f0-9]{32}$'
      or coalesce(review->>'snapshot_sha256','') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(review->'batch_id') is distinct from 'string' or length(review->>'batch_id')=0
      or jsonb_typeof(review->'payload_json') is distinct from 'string'
      or jsonb_typeof(review->'quality_status') is distinct from 'string'
      or jsonb_typeof(review->'created_at') is distinct from 'string'
      or jsonb_typeof(review->'expires_at') is distinct from 'string'
      or review->'superseded_by' is distinct from 'null'::jsonb
      then raise exception 'REVIEW_INPUT_INVALID'; end if;
   payload := (review->>'payload_json')::jsonb;
   if jsonb_typeof(payload) is distinct from 'object'
      or payload->>'snapshot_id' is distinct from review->>'snapshot_id'
      or payload->>'snapshot_sha256' is distinct from review->>'snapshot_sha256'
      or (review->>'expires_at')::timestamptz<=now()
      or (review->>'created_at')::timestamptz>=(review->>'expires_at')::timestamptz
      then raise exception 'REVIEW_INPUT_INVALID'; end if;
   select document into review_batch from public.sigap_entities
    where kind='batches' and id=review->>'batch_id' for update;
   if not found or review_batch->>'session_id' is distinct from p_args->>'session_id'
      or coalesce(review_batch->>'status','') not in ('processing','ready_for_review')
      then raise exception 'REVIEW_BATCH_NOT_EDITABLE'; end if;
   select document into existing_review from public.sigap_entities
    where kind='snapshots' and id=review->>'snapshot_id';
   if found then
    -- Existing payloads are never overwritten. Backend verifies immutable fields
    -- and exact normalized payload before any replay status/payload update.
    return jsonb_build_object('created',false,'snapshot',existing_review);
   end if;
   review := review || jsonb_build_object('version',case when review_batch->>'latest_snapshot_id' is null then 1 else 2 end);
   insert into public.sigap_entities(kind,id,document) values('snapshots',review->>'snapshot_id',review);
   update public.sigap_entities set document=document||jsonb_build_object(
    'status','ready_for_review','latest_snapshot_id',review->>'snapshot_id',
    'latest_snapshot_sha256',review->>'snapshot_sha256','quality_status',review->>'quality_status',
    'preview_payload_json',review->>'payload_json','updated_at',review->>'created_at')
    where kind='batches' and id=review->>'batch_id';
   return jsonb_build_object('created',true,'snapshot',review);
  end;
$addition$;
begin
 perform set_config('lock_timeout','3s',true);
 definition := replace(pg_get_functiondef('public.sigap_dispatch(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,'sigap:review-preparation-v1')=0 then
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'UNEXPECTED_DISPATCH_DEFINITION'; end if;
  execute replace(definition,anchor,addition||anchor);
 end if;
end
$migration$;
