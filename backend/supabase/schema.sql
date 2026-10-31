-- SIGAP backend-owned API. User JWTs cannot write operational tables directly.
create schema if not exists sigap_private;
revoke all on schema sigap_private from public, anon, authenticated;
grant usage on schema sigap_private to service_role;
grant usage on schema auth to service_role;
grant select(id,email,email_confirmed_at) on auth.users to service_role;
grant select(id,user_id,not_after) on auth.sessions to service_role;
create table public.sigap_organizations(id uuid primary key default gen_random_uuid(), name text not null);
create table public.sigap_memberships(
 user_id uuid primary key references auth.users(id), organization_id uuid references public.sigap_organizations(id),
 role text check(role in ('admin','petugas','viewer')), status text not null default 'pending' check(status in ('pending','active','disabled')),
 display_name text not null default '', scopes text[] not null default '{}', updated_at timestamptz not null default now(),
 check(status <> 'active' or (role is not null and organization_id is not null)));
create table public.sigap_contexts(organization_id uuid references public.sigap_organizations(id),context_id text not null,
 name text not null,primary key(organization_id,context_id));
create table public.sigap_entities(seq bigint generated always as identity primary key,kind text not null,id text not null,
 document jsonb not null,unique(kind,id));
create index sigap_entities_filter on public.sigap_entities using gin(document jsonb_path_ops);
create unique index sigap_one_approval on public.sigap_entities((document->>'batch_id'),(document->>'snapshot_id'))
 where kind='approvals' and document->>'status' in ('pending','consumed','expired');
create unique index sigap_request_id on public.sigap_entities((document->>'request_id')) where kind='batches';
create unique index sigap_active_batch on public.sigap_entities((document->>'session_id')) where kind='batches' and document->>'status' in ('processing','saving','verifying');
create table public.sigap_storage(organization_id uuid not null references public.sigap_organizations(id),context_id text not null,
 revision bigint not null default 0,document jsonb not null default '{"header":[],"rows":[]}',primary key(organization_id,context_id),
 foreign key(organization_id,context_id) references public.sigap_contexts);
create table public.sigap_storage_history(id bigint generated always as identity primary key,organization_id uuid not null,context_id text not null,
 commit_key text not null,request_hash text not null,before_document jsonb not null,after_document jsonb not null,result jsonb not null,
 actor_id uuid references auth.users(id),created_at timestamptz not null default now(),unique(organization_id,context_id,commit_key));
create table public.sigap_flow_snapshots(id text primary key,organization_id uuid not null,context_id text not null,
 envelope jsonb not null,committed_reference jsonb,created_at timestamptz not null default now(),
 foreign key(organization_id,context_id) references public.sigap_contexts);
create table public.sigap_publications(id uuid primary key default gen_random_uuid(),organization_id uuid not null,context_id text not null,
 content text not null,content_sha256 text not null,approved_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(organization_id,context_id,content_sha256));
create table sigap_private.gateway_secret(id boolean primary key default true check(id),secret text not null);
create table sigap_private.gateway_nonces(nonce uuid primary key,created_at timestamptz not null default now());
create table sigap_private.revoked_sessions(session_id text primary key,created_at timestamptz not null default now());
create index sigap_history_actor on public.sigap_storage_history(actor_id);
create index sigap_publication_actor on public.sigap_publications(approved_by);
create index sigap_membership_org on public.sigap_memberships(organization_id);
alter table public.sigap_organizations enable row level security;
alter table public.sigap_memberships enable row level security;
alter table public.sigap_contexts enable row level security;
alter table public.sigap_entities enable row level security;
alter table public.sigap_storage enable row level security;
alter table public.sigap_storage_history enable row level security;
alter table public.sigap_flow_snapshots enable row level security;
alter table public.sigap_publications enable row level security;
alter table sigap_private.gateway_secret enable row level security;
alter table sigap_private.gateway_nonces enable row level security;
alter table sigap_private.revoked_sessions enable row level security;
revoke all on public.sigap_organizations,public.sigap_memberships,public.sigap_contexts,public.sigap_entities,
 public.sigap_storage,public.sigap_storage_history,public.sigap_flow_snapshots,public.sigap_publications from anon,authenticated;
grant all on all tables in schema sigap_private to service_role;
grant all on public.sigap_organizations,public.sigap_memberships,public.sigap_contexts,public.sigap_entities,
 public.sigap_storage,public.sigap_storage_history,public.sigap_flow_snapshots,public.sigap_publications to service_role;
grant usage,select on all sequences in schema public to service_role;
grant select on public.sigap_memberships,public.sigap_publications to authenticated;
create policy membership_self on public.sigap_memberships for select to authenticated using(user_id=(select auth.uid()));
create policy approved_publication on public.sigap_publications for select to authenticated using(exists(
 select 1 from public.sigap_memberships m where m.user_id=(select auth.uid()) and m.status='active' and m.organization_id=sigap_publications.organization_id
 and (m.role in ('admin','viewer') or sigap_publications.context_id=any(m.scopes))));
-- Explicit deny policies document server-only tables without granting client privileges.
do $policy$ declare name text; begin
 foreach name in array array['public.sigap_organizations','public.sigap_contexts','public.sigap_entities','public.sigap_storage','public.sigap_storage_history','public.sigap_flow_snapshots','sigap_private.gateway_secret','sigap_private.gateway_nonces','sigap_private.revoked_sessions'] loop
  execute format('create policy backend_only on %s for all to anon, authenticated using (false) with check (false)',name);
 end loop;
end $policy$;

-- Invoker functions, callable only by service_role through a separately authenticated gateway.
create function public.sigap_gateway_secret() returns text language sql security invoker set search_path='' as $$
 select secret from sigap_private.gateway_secret where id=true;
$$;
create function public.sigap_gateway_nonce(p_nonce uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 delete from sigap_private.gateway_nonces where created_at < now()-interval '5 minutes';
 insert into sigap_private.gateway_nonces(nonce) values(p_nonce) on conflict do nothing;
 return found;
end $$;
-- Additive upgrade for an existing SIGAP installation. Keeps all operational data.
alter table public.sigap_contexts add column description text not null default '';
alter table public.sigap_contexts add column created_at timestamptz not null default now();

create table public.sigap_join_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.sigap_organizations(id),
 user_id uuid not null references auth.users(id),
 note text not null default '' check(length(note)<=500),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), decided_at timestamptz,
 decided_by uuid references auth.users(id), unique(organization_id,user_id)
);
create table public.sigap_invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.sigap_organizations(id),
 email text not null check(email=lower(email) and length(email)<=254),
 role text not null check(role in ('admin','petugas','viewer')),
 scopes text[] not null default '{}',
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 accepted_by uuid references auth.users(id), accepted_at timestamptz, revoked_at timestamptz
);
create index sigap_join_user on public.sigap_join_requests(user_id);
create index sigap_join_decider on public.sigap_join_requests(decided_by);
create index sigap_invitation_org on public.sigap_invitations(organization_id);
create index sigap_invitation_creator on public.sigap_invitations(created_by);
create index sigap_invitation_recipient on public.sigap_invitations(accepted_by);
alter table public.sigap_join_requests enable row level security;
alter table public.sigap_invitations enable row level security;
revoke all on public.sigap_join_requests,public.sigap_invitations from public,anon,authenticated;
grant all on public.sigap_join_requests,public.sigap_invitations to service_role;
create policy backend_only on public.sigap_join_requests for all to anon,authenticated using(false) with check(false);
create policy backend_only on public.sigap_invitations for all to anon,authenticated using(false) with check(false);

create function public.sigap_command_dispatch(p_action text,p_args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 actor uuid := (p_args->>'actor_id')::uuid;
 org uuid; ctx text := p_args->>'context_id';
 m public.sigap_memberships; target public.sigap_memberships;
 invitation public.sigap_invitations; application public.sigap_join_requests;
 r jsonb; selected_role text; selected_scopes text[]; email_address text; event_type text;
begin
 if p_action='command.info' then
  return (select jsonb_build_object('id',id,'name',name) from public.sigap_organizations where id=(p_args->>'organization_id')::uuid);
 end if;
 -- All membership-changing actions serialize by command and then by user.
 select * into m from public.sigap_memberships where user_id=actor;
 if m.user_id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 org=case when p_action like 'membership.%' then (p_args->>'organization_id')::uuid else m.organization_id end;
 if org is null or not exists(select 1 from public.sigap_organizations where id=org) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text,0));
 select * into m from public.sigap_memberships where user_id=actor for update;

 if p_action='membership.requests' then
  return (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') from public.sigap_join_requests q where q.user_id=actor and q.organization_id=org);
 elsif p_action in ('membership.request','membership.accept') then
  -- Joining cannot transfer an existing member or reactivate a disabled account.
  if m.status<>'pending' or m.organization_id is not null or m.role is not null then raise exception 'JOIN_NOT_ALLOWED' using errcode='42501'; end if;
  select lower(email) into email_address from auth.users where id=actor and email_confirmed_at is not null;
  if email_address is null then raise exception 'VERIFIED_USER_REQUIRED' using errcode='42501'; end if;
  if p_action='membership.request' then
   insert into public.sigap_join_requests(organization_id,user_id,note) values(org,actor,coalesce(p_args->>'note',''))
    on conflict(organization_id,user_id) do update set note=excluded.note,status='pending',created_at=now(),decided_at=null,decided_by=null
    returning to_jsonb(sigap_join_requests.*) into r;
   event_type='JOIN_REQUESTED';
  else
   select * into invitation from public.sigap_invitations where token_hash=p_args->>'token_hash' and organization_id=org for update;
   if invitation.id is null or invitation.email<>email_address or invitation.expires_at<=now()
    or invitation.accepted_at is not null or invitation.revoked_at is not null
    or not exists(select 1 from public.sigap_memberships where user_id=invitation.created_by and organization_id=org and role='admin' and status='active')
    then raise exception 'INVITATION_REJECTED' using errcode='42501'; end if;
   if exists(select 1 from unnest(invitation.scopes) scope where not exists(select 1 from public.sigap_contexts c where c.organization_id=org and c.context_id=scope)) then raise exception 'INVALID_SCOPE' using errcode='42501'; end if;
   update public.sigap_memberships set organization_id=org,role=invitation.role,status='active',scopes=invitation.scopes,updated_at=now() where user_id=actor returning to_jsonb(sigap_memberships.*) into r;
   update public.sigap_invitations set accepted_by=actor,accepted_at=now() where id=invitation.id;
   update public.sigap_join_requests set status='approved',decided_at=now(),decided_by=invitation.created_by where organization_id=org and user_id=actor and status='pending';
   event_type='INVITATION_ACCEPTED';
  end if;
 elsif p_action like 'admin.%' then
  if m.status<>'active' or m.role<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_action='admin.command.get' then
   return (select to_jsonb(o) from public.sigap_organizations o where id=org);
  elsif p_action='admin.command.update' then
   if coalesce(length(btrim(p_args->>'name')),0) not between 1 and 120 then raise exception 'INVALID_COMMAND'; end if;
   update public.sigap_organizations set name=btrim(p_args->>'name') where id=org returning to_jsonb(sigap_organizations.*) into r;
   event_type='COMMAND_UPDATED';
  elsif p_action='admin.requests' then
   return (select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object('display_name',p.display_name) order by q.created_at desc),'[]') from public.sigap_join_requests q join public.sigap_memberships p on p.user_id=q.user_id where q.organization_id=org and q.status='pending' and p.status='pending' and p.organization_id is null);
  elsif p_action='admin.request.decide' then
   select * into application from public.sigap_join_requests where id=(p_args->>'request_id')::uuid and organization_id=org for update;
   if application.id is null or application.status<>'pending' then raise exception 'REQUEST_NOT_PENDING' using errcode='42501'; end if;
   select * into target from public.sigap_memberships where user_id=application.user_id for update;
   if target.status<>'pending' or target.organization_id is not null or target.role is not null then raise exception 'JOIN_NOT_ALLOWED' using errcode='42501'; end if;
   if p_args->>'decision'='approve' then
    if not exists(select 1 from auth.users where id=target.user_id and email_confirmed_at is not null) then raise exception 'VERIFIED_USER_REQUIRED' using errcode='42501'; end if;
    selected_role=p_args->>'role'; selected_scopes=array(select jsonb_array_elements_text(p_args->'scopes'));
    if selected_role is null or selected_role not in ('admin','petugas','viewer') or jsonb_typeof(p_args->'scopes') is distinct from 'array'
     or cardinality(selected_scopes)>100 or exists(select 1 from unnest(selected_scopes) scope where not exists(select 1 from public.sigap_contexts c where c.organization_id=org and c.context_id=scope)) then raise exception 'INVALID_ASSIGNMENT' using errcode='42501'; end if;
    update public.sigap_memberships set organization_id=org,role=selected_role,status='active',scopes=selected_scopes,updated_at=now() where user_id=target.user_id;
   elsif p_args->>'decision' is distinct from 'reject' then raise exception 'INVALID_DECISION'; end if;
   update public.sigap_join_requests set status=case when p_args->>'decision'='approve' then 'approved' else 'rejected' end,decided_at=now(),decided_by=actor where id=application.id returning to_jsonb(sigap_join_requests.*) into r;
   event_type='JOIN_REQUEST_DECIDED';
  elsif p_action='admin.invitation.create' then
   selected_role=p_args->>'role'; selected_scopes=array(select jsonb_array_elements_text(p_args->'scopes'));
   if selected_role is null or selected_role not in ('admin','petugas','viewer') or jsonb_typeof(p_args->'scopes') is distinct from 'array'
    or cardinality(selected_scopes)>100 or exists(select 1 from unnest(selected_scopes) scope where not exists(select 1 from public.sigap_contexts c where c.organization_id=org and c.context_id=scope)) then raise exception 'INVALID_ASSIGNMENT' using errcode='42501'; end if;
   if (p_args->>'expires_at')::timestamptz<=now() or (p_args->>'expires_at')::timestamptz>now()+interval '7 days' then raise exception 'INVALID_EXPIRY'; end if;
   insert into public.sigap_invitations(organization_id,email,role,scopes,token_hash,created_by,expires_at)
    values(org,lower(p_args->>'email'),selected_role,selected_scopes,p_args->>'token_hash',actor,(p_args->>'expires_at')::timestamptz)
    returning to_jsonb(sigap_invitations.*)-'token_hash' into r;
   event_type='INVITATION_CREATED';
  elsif p_action='admin.invitations' then
   return (select coalesce(jsonb_agg(to_jsonb(i)-'token_hash' order by i.created_at desc),'[]') from public.sigap_invitations i where i.organization_id=org);
  elsif p_action='admin.invitation.revoke' then
   update public.sigap_invitations set revoked_at=coalesce(revoked_at,now()) where id=(p_args->>'invitation_id')::uuid and organization_id=org and accepted_at is null returning to_jsonb(sigap_invitations.*)-'token_hash' into r;
   if r is null then raise exception 'INVITATION_NOT_FOUND' using errcode='42501'; end if;
   event_type='INVITATION_REVOKED';
  elsif p_action in ('admin.operation.create','admin.operation.update') then
   if ctx !~ '^[a-zA-Z0-9_-]{1,80}$' or coalesce(length(btrim(p_args->>'name')),0) not between 1 and 120 or length(coalesce(p_args->>'description',''))>1000 then raise exception 'INVALID_OPERATION'; end if;
   if p_action='admin.operation.create' then
    insert into public.sigap_contexts(organization_id,context_id,name,description) values(org,ctx,btrim(p_args->>'name'),coalesce(p_args->>'description','')) returning to_jsonb(sigap_contexts.*) into r;
   else
    update public.sigap_contexts set name=btrim(p_args->>'name'),description=coalesce(p_args->>'description','') where organization_id=org and context_id=ctx returning to_jsonb(sigap_contexts.*) into r;
    if r is null then raise exception 'SCOPE_DENIED' using errcode='42501'; end if;
   end if;
   event_type='OPERATION_UPDATED';
  else raise exception 'UNKNOWN_ACTION'; end if;
 elsif p_action='context.get' then
  if m.status<>'active' or m.role not in ('admin','petugas') or m.role<>'admin' and not ctx=any(m.scopes) then raise exception 'SCOPE_DENIED' using errcode='42501'; end if;
  select to_jsonb(c) into r from public.sigap_contexts c where c.organization_id=org and c.context_id=ctx;
  if r is null then raise exception 'SCOPE_DENIED' using errcode='42501'; end if;
  return r;
 else raise exception 'UNKNOWN_ACTION'; end if;
 insert into public.sigap_entities(kind,id,document) values('audit_log',gen_random_uuid()::text,
  jsonb_build_object('event_type',event_type,'actor_id',actor,'organization_id',org,'resource_id',coalesce(r->>'id',ctx,org::text),'created_at',now()));
 return r;
end $$;
revoke execute on function public.sigap_command_dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function public.sigap_command_dispatch(text,jsonb) to service_role;

-- The matching, complete sigap_dispatch replacement follows below.
create function public.sigap_dispatch(p_action text,p_args jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; n bigint; m public.sigap_memberships; target public.sigap_memberships; s public.sigap_storage;
 actor uuid; org uuid; ctx text; prior public.sigap_storage_history; a jsonb; d jsonb; v text;
begin
 if p_action='command.info' or p_action like 'membership.%' or p_action like 'admin.command.%'
  or p_action in ('admin.requests','admin.request.decide','admin.invitations','context.get')
  or p_action like 'admin.invitation.%' or p_action like 'admin.operation.%' then
  return public.sigap_command_dispatch(p_action,p_args);
 end if;
 if p_action='migration.import' then
  org=(p_args->>'organization_id')::uuid;ctx=p_args->>'context_id';
  perform pg_advisory_xact_lock(hashtextextended(org::text||':migration',0));
  select document into r from public.sigap_entities where kind='migration_receipts' and id=p_args->>'manifest_hash';
  if found then return r; end if;
  if exists(select 1 from public.sigap_entities) or exists(select 1 from public.sigap_storage) then raise exception 'MIGRATION_TARGET_NOT_EMPTY'; end if;
  insert into public.sigap_contexts(organization_id,context_id,name) values(org,ctx,'Rekap migrasi awal');
  for a in select value from jsonb_array_elements(p_args->'entities') loop
   insert into public.sigap_entities(kind,id,document) values(a->>'kind',a->>'id',a->'document');
  end loop;
  insert into public.sigap_storage(organization_id,context_id,revision,document) values(org,ctx,1,p_args->'storage');
  r=jsonb_build_object('manifest_hash',p_args->>'manifest_hash','entity_count',jsonb_array_length(p_args->'entities'),'shelter_count',jsonb_array_length(p_args->'storage'->'rows'),'created_at',now());
  insert into public.sigap_entities(kind,id,document) values('migration_receipts',p_args->>'manifest_hash',r);
  perform setval(pg_get_serial_sequence('public.sigap_entities','seq'),greatest((select max(seq) from public.sigap_entities),coalesce((select max((document->>'event_id')::bigint) from public.sigap_entities where kind='events'),0)));
  return r;
 elsif p_action='migration.verify' then
  return jsonb_build_object('mismatch_count',(select count(*) from jsonb_array_elements(p_args->'entities') expected
    left join public.sigap_entities actual on actual.kind=expected->>'kind' and actual.id=expected->>'id' where actual.document is distinct from expected->'document'),
    'entity_count',(select count(*) from public.sigap_entities where kind<>'migration_receipts'),
    'storage_matches',(select document=p_args->'storage' from public.sigap_storage where organization_id=(p_args->>'organization_id')::uuid and context_id=p_args->>'context_id'));
 elsif p_action='bootstrap.admin' then
  perform pg_advisory_xact_lock(5544332211);
  if exists(select 1 from public.sigap_memberships where role='admin' and status='active') then raise exception 'ADMIN_ALREADY_EXISTS'; end if;
  select id::text into v from auth.users where lower(email)=lower(p_args->>'email') and email_confirmed_at is not null;
  if v is null then raise exception 'VERIFIED_USER_REQUIRED'; end if;
  insert into public.sigap_memberships(user_id,organization_id,role,status) values(v::uuid,(p_args->>'organization_id')::uuid,'admin','active')
   on conflict(user_id) do update set organization_id=excluded.organization_id,role='admin',status='active',updated_at=now();
  return jsonb_build_object('user_id',v,'role','admin');
 elsif p_action='profile.ensure' then
  insert into public.sigap_memberships(user_id,display_name) values((p_args->>'user_id')::uuid,left(coalesce(p_args->>'display_name',''),120)) on conflict do nothing;
  return (select to_jsonb(x) from public.sigap_memberships x where user_id=(p_args->>'user_id')::uuid);
 elsif p_action='profile.get' then
  return (select to_jsonb(x) from public.sigap_memberships x where user_id=(p_args->>'user_id')::uuid);
 elsif p_action='session.revoke' then
  insert into sigap_private.revoked_sessions values(p_args->>'session_id',now()) on conflict do nothing; return 'true';
 elsif p_action='session.valid' then
  return to_jsonb(exists(select 1 from auth.sessions where id::text=p_args->>'session_id' and user_id=(p_args->>'user_id')::uuid
   and (not_after is null or not_after>now())) and not exists(select 1 from sigap_private.revoked_sessions where session_id=p_args->>'session_id'));
 elsif p_action='entity.get' then
  return (select document from public.sigap_entities where kind=p_args->>'kind' and id=p_args->>'id');
 elsif p_action='approval.consume' then
  select document into a from public.sigap_entities where kind='approvals' and id=p_args->>'id' for update;
  if not found or a->>'status'<>'pending' then return 'false'; end if;
  select document into r from public.sigap_entities where kind='snapshots' and id=a->>'snapshot_id' for share;
  select document into d from public.sigap_entities where kind='batches' and id=a->>'batch_id' for share;
  if r->>'superseded_by' is not null or (r->>'expires_at')::timestamptz<=now() or d->>'latest_snapshot_id'<>r->>'snapshot_id' then return 'false'; end if;
  if not exists(select 1 from public.sigap_memberships where user_id::text=a->>'actor_id' and status='active' and role in ('admin','petugas')) then return 'false'; end if;
  update public.sigap_entities set document=document||jsonb_build_object('status','consumed','consumed_at',now()) where kind='approvals' and id=p_args->>'id';return 'true';
 elsif p_action='entity.list' then
  return (select coalesce(jsonb_agg(document order by seq),'[]') from public.sigap_entities where kind=p_args->>'kind' and document @> coalesce(p_args->'filter','{}'));
 elsif p_action='entity.put' then
  insert into public.sigap_entities(kind,id,document) values(p_args->>'kind',p_args->>'id',p_args->'document') returning seq into n;
  if p_args->>'kind'='events' then update public.sigap_entities set document=document||jsonb_build_object('event_id',n) where seq=n; end if;
  return (select document from public.sigap_entities where seq=n);
 elsif p_action='entity.patch' then
  update public.sigap_entities set document=document||(p_args->'patch') where kind=p_args->>'kind' and id=p_args->>'id'
   and document @> coalesce(p_args->'expected','{}') returning document into r;
  return r;
 end if;
 actor=(p_args->>'actor_id')::uuid;
 select * into m from public.sigap_memberships where user_id=actor;
 if m.user_id is null or m.status<>'active' then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 org=m.organization_id;ctx=p_args->>'context_id';
 if p_action like 'admin.%' then
  if m.role<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text,0));
  if p_action='admin.users' then
   return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.sigap_memberships x where organization_id=org);
  elsif p_action='admin.update' then
   select * into target from public.sigap_memberships where user_id=(p_args->>'user_id')::uuid for update;
   if target.user_id is null or target.organization_id is distinct from org then raise exception 'USER_NOT_FOUND'; end if;
   if actor=target.user_id then raise exception 'SELF_CHANGE_FORBIDDEN'; end if;
   if target.role='admin' and target.status='active' and (p_args->>'role'<>'admin' or p_args->>'status'<>'active')
    and (select count(*) from public.sigap_memberships where organization_id=org and role='admin' and status='active')<=1 then raise exception 'LAST_ADMIN'; end if;
   if exists(select 1 from jsonb_array_elements_text(p_args->'scopes') q where not exists(select 1 from public.sigap_contexts c where c.organization_id=org and c.context_id=q.value)) then raise exception 'INVALID_SCOPE'; end if;
   update public.sigap_memberships set organization_id=org,role=p_args->>'role',status=p_args->>'status',
    scopes=array(select jsonb_array_elements_text(p_args->'scopes')),updated_at=now() where user_id=target.user_id returning to_jsonb(sigap_memberships.*) into r;
   insert into public.sigap_entities(kind,id,document) values('audit_log',gen_random_uuid()::text,jsonb_build_object('event_type','MEMBERSHIP_CHANGED','actor_id',actor,'resource_id',target.user_id,'organization_id',org,'created_at',now(),'details',p_args-'actor_id'));
   return r;
  elsif p_action='admin.context' then
   insert into public.sigap_contexts(organization_id,context_id,name) values(org,ctx,p_args->>'name') on conflict(organization_id,context_id) do update set name=excluded.name; return 'true';
  elsif p_action='admin.audit' then
   return (select coalesce(jsonb_agg(document order by seq),'[]') from public.sigap_entities where kind='audit_log' and document->>'organization_id'=org::text);
  end if;
 end if;
 if p_action='contexts' then return (select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.sigap_contexts c where organization_id=org and (m.role='admin' or context_id=any(m.scopes))); end if;
 if p_action='audit.own' and m.role in ('admin','petugas') then return (select coalesce(jsonb_agg(document order by seq),'[]') from public.sigap_entities where kind='audit_log' and document->>'organization_id'=org::text and document->>'actor_id'=actor::text); end if;
 if p_action='publications.list' then return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.sigap_publications x where organization_id=org and (m.role in ('admin','viewer') or context_id=any(m.scopes))); end if;
 if m.role not in ('admin','petugas') or not exists(select 1 from public.sigap_contexts where organization_id=org and context_id=ctx)
  or m.role<>'admin' and not ctx=any(m.scopes) then raise exception 'SCOPE_DENIED' using errcode='42501'; end if;
 if p_action='scope.check' then return to_jsonb(m); end if;
 if p_action='publication.approve' then
  if m.role<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  select document into a from public.sigap_entities where kind='batches' and id=p_args->>'batch_id';
  select document into d from public.sigap_entities where kind='sessions' and id=a->>'session_id';
  if d->>'organization_id'<>org::text or d->>'context_id'<>ctx or a->>'bulletin_payload_json' is null then raise exception 'INVALID_PUBLICATION'; end if;
  r=(a->>'bulletin_payload_json')::jsonb;
  if p_args->>'content_sha256'<>r->>'content_sha256' or coalesce(r->>'content','')='' then raise exception 'PREVIEW_CHANGED'; end if;
  insert into public.sigap_publications(organization_id,context_id,content,content_sha256,approved_by) values(org,ctx,r->>'content',r->>'content_sha256',actor) returning to_jsonb(sigap_publications.*) into r;
  insert into public.sigap_entities(kind,id,document) values('audit_log',gen_random_uuid()::text,jsonb_build_object('event_type','PUBLICATION_APPROVED','actor_id',actor,'organization_id',org,'resource_id',r->>'id','created_at',now()));
  return r;
 elsif p_action='storage.read' then
  select * into s from public.sigap_storage where organization_id=org and context_id=ctx;
  return jsonb_build_object('revision',coalesce(s.revision,0),'document',coalesce(s.document,'{"header":[],"rows":[]}'));
 elsif p_action='storage.receipt' then
  select * into prior from public.sigap_storage_history where organization_id=org and context_id=ctx and commit_key=p_args->>'commit_key';
  if not found then return null; end if;
  if prior.request_hash<>p_args->>'request_hash' then raise exception 'COMMIT_MISMATCH'; end if;
  return prior.result||'{"replayed":true}';
 elsif p_action='storage.commit' then
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||ctx,0));
  select * into prior from public.sigap_storage_history where organization_id=org and context_id=ctx and commit_key=p_args->>'commit_key';
  if found then
   if prior.request_hash<>p_args->>'request_hash' then raise exception 'COMMIT_MISMATCH'; end if;
   return prior.result||'{"replayed":true}';
  end if;
  insert into public.sigap_storage(organization_id,context_id) values(org,ctx) on conflict do nothing;
  select * into s from public.sigap_storage where organization_id=org and context_id=ctx for update;
  if s.revision<>(p_args->>'revision')::bigint then raise exception 'STALE_STORAGE'; end if;
  update public.sigap_storage set document=p_args->'document',revision=revision+1 where organization_id=org and context_id=ctx;
  insert into public.sigap_storage_history(organization_id,context_id,commit_key,request_hash,before_document,after_document,result,actor_id)
   values(org,ctx,p_args->>'commit_key',p_args->>'request_hash',s.document,p_args->'document',p_args->'result',actor);
  return p_args->'result';
 elsif p_action='flow.save' then
  insert into public.sigap_flow_snapshots values(p_args->>'id',org,ctx,p_args->'envelope',null,now());return 'true';
 elsif p_action='flow.load' then
  return (select jsonb_build_object('envelope',envelope,'committed_reference',committed_reference) from public.sigap_flow_snapshots where id=p_args->>'id' and organization_id=org and context_id=ctx);
 elsif p_action='flow.commit' then
  update public.sigap_flow_snapshots set committed_reference=p_args->'reference' where id=p_args->>'id' and organization_id=org and context_id=ctx and committed_reference is null;
  return to_jsonb(found);
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
revoke execute on function public.sigap_gateway_secret(),public.sigap_gateway_nonce(uuid),public.sigap_dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function public.sigap_gateway_secret(),public.sigap_gateway_nonce(uuid),public.sigap_dispatch(text,jsonb) to service_role;
