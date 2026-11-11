-- Installed only in a fresh isolated SIGAP local database, within the baseline transaction.
\getenv gateway_secret SIGAP_SUPABASE_GATEWAY_SECRET
insert into sigap_private.gateway_secret(id,secret) values (true, :'gateway_secret');

create table sigap_private.local_installation (
 id boolean primary key default true check(id), seeded boolean not null default false
);
create table sigap_private.local_schema_migrations (
 version text primary key, sha256 text not null, installed_at timestamptz not null default now()
);
alter table sigap_private.local_installation enable row level security;
alter table sigap_private.local_schema_migrations enable row level security;
revoke all on sigap_private.local_installation,sigap_private.local_schema_migrations from public,anon,authenticated;
grant select,update on sigap_private.local_installation to service_role;
grant select(raw_app_meta_data) on auth.users to service_role;
insert into sigap_private.local_installation(id) values(true);
insert into sigap_private.local_schema_migrations(version,sha256) values('20261109164020',:'baseline_sha');

create function public.sigap_local_seeded() returns boolean language sql stable security invoker set search_path='' as $$
 select seeded from sigap_private.local_installation where id=true;
$$;

create function public.sigap_local_seed(p_org uuid,p_users jsonb,p_document jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare already boolean; uid uuid; item jsonb; n int;
begin
 select seeded into already from sigap_private.local_installation where id=true for update;
 if already then return false; end if;
 if p_org is null or jsonb_typeof(p_users) is distinct from 'object'
  or jsonb_typeof(p_document->'header') is distinct from 'array'
  or jsonb_typeof(p_document->'rows') is distinct from 'array'
  or jsonb_array_length(p_document->'rows')<>8 then raise exception 'LOCAL_SEED_INVALID'; end if;
 if exists(select 1 from public.sigap_organizations) or exists(select 1 from public.sigap_memberships)
  or exists(select 1 from public.sigap_storage) or exists(select 1 from public.sigap_entities)
  then raise exception 'LOCAL_SEED_TARGET_NOT_EMPTY'; end if;
 for item in select value from jsonb_each(p_users) loop
  uid:=(item#>>'{}')::uuid;
  if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null
    and raw_app_meta_data->>'sigap_local_installation'=p_org::text) then raise exception 'LOCAL_SEED_USER_INVALID'; end if;
 end loop;
 select count(*) into n from jsonb_object_keys(p_users);
 if n<>3 or not (p_users ?& array['admin','petugas','viewer']) then raise exception 'LOCAL_SEED_USER_INVALID'; end if;
 if (select count(distinct value) from jsonb_each_text(p_users))<>3 then raise exception 'LOCAL_SEED_USER_INVALID'; end if;
 insert into public.sigap_organizations(id,name) values(p_org,'SIGAP Lokal Demo');
 insert into public.sigap_contexts(organization_id,context_id,name) values
  (p_org,'posko-default','Posko Demo'),(p_org,'posko-latihan','Posko Latihan');
 insert into public.sigap_memberships(user_id,organization_id,role,status,display_name,scopes) values
  ((p_users->>'admin')::uuid,p_org,'admin','active','Admin Demo','{}'),
  ((p_users->>'petugas')::uuid,p_org,'petugas','active','Petugas Demo','{posko-default}'),
  ((p_users->>'viewer')::uuid,p_org,'viewer','active','Viewer Demo','{posko-default}');
 insert into public.sigap_storage(organization_id,context_id,revision,document) values(p_org,'posko-default',1,p_document);
 update sigap_private.local_installation set seeded=true where id=true;
 return true;
end $$;
revoke execute on function public.sigap_local_seeded(),public.sigap_local_seed(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sigap_local_seeded(),public.sigap_local_seed(uuid,jsonb,jsonb) to service_role;
