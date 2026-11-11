-- Add one session-scoped, bounded read. No entity/storage writes or grant changes.
do $migration$
declare definition text; prior_branch text := $prior$ elsif p_action='entity.list' then
  -- sigap:event-history-cursor-v1:$prior$;
 new_branch text := $next$ elsif p_action='entity.list' then
  -- sigap:submission-state-v1: one bounded response for message preflight.
  if p_args->>'kind'='batches' and p_args->'submission_state'='true'::jsonb then
   if jsonb_typeof(p_args->'filter'->'session_id') is distinct from 'string'
      or length(p_args->'filter'->>'session_id')=0
      or p_args->'filter' is distinct from jsonb_build_object('session_id',p_args->'filter'->>'session_id')
      then raise exception 'SUBMISSION_SESSION_REQUIRED'; end if;
   if jsonb_typeof(p_args->'request_id') is distinct from 'string'
      or left(p_args->>'request_id',length(p_args->'filter'->>'session_id')+1)<>(p_args->'filter'->>'session_id')||':'
      or length(p_args->>'request_id')<=length(p_args->'filter'->>'session_id')+1
      then raise exception 'SUBMISSION_REQUEST_INVALID'; end if;
   return jsonb_build_object(
    'existingBatch',(select document from public.sigap_entities where kind='batches'
      and document->>'request_id'=p_args->>'request_id'
      and document->>'session_id'=p_args->'filter'->>'session_id' limit 1),
    'activeBatchId',(select document->'batch_id' from public.sigap_entities where kind='batches'
      and document->>'session_id'=p_args->'filter'->>'session_id'
      and document->>'status' in ('processing','saving','verifying') limit 1),
    'firstTurn',not exists(select 1 from public.sigap_entities where kind='batches' and document @> (p_args->'filter')));
  end if;
  -- sigap:event-history-cursor-v1:$next$;
begin
 perform set_config('lock_timeout','3s',true);
 definition := replace(pg_get_functiondef('public.sigap_dispatch(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,'sigap:submission-state-v1')=0 then
  if (length(definition)-length(replace(definition,prior_branch,'')))/length(prior_branch)<>1
   then raise exception 'UNEXPECTED_DISPATCH_DEFINITION'; end if;
  execute replace(definition,prior_branch,new_branch);
 end if;
end
$migration$;
