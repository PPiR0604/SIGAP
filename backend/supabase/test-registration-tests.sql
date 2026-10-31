-- Disposable local database only, after test-bootstrap.sql and schema.sql.
alter table auth.users add column raw_user_meta_data jsonb not null default '{}';
alter table auth.users add column is_anonymous boolean not null default false;
insert into public.sigap_organizations(id,name) values('11111111-1111-4111-8111-111111111111','Test');
insert into auth.users(id,email) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin@example.test'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','pending@example.test');
insert into public.sigap_memberships(user_id,organization_id,role,status) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','admin','active');
insert into public.sigap_memberships(user_id) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
\ir test-registration.sql
insert into auth.users(id,email,raw_user_meta_data) values
 ('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','one@example.test','{"display_name":"Satu","role":"admin"}'),
 ('22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa','two@example.test','{"display_name":"Dua"}');
do $$
declare a uuid := '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; b uuid := '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; ca text; cb text; d jsonb;
begin
 select scopes[1] into ca from public.sigap_memberships where user_id=a and role='petugas' and status='active';
 select scopes[1] into cb from public.sigap_memberships where user_id=b and role='petugas' and status='active';
 if ca is null or cb is null or ca=cb then raise exception 'Missing or shared workspaces'; end if;
 if (select status from public.sigap_memberships where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 'pending' then raise exception 'Existing membership changed'; end if;
 d:=public.sigap_dispatch('storage.read',jsonb_build_object('actor_id',a,'context_id',ca));
 if jsonb_array_length(d->'document'->'rows')<>8 then raise exception 'Missing synthetic shelter data'; end if;
 if (select sum((row->>8)::int) from jsonb_array_elements(d->'document'->'rows') row)<>630 then raise exception 'Incorrect baseline population'; end if;
 if (select count(*) from jsonb_array_elements(d->'document'->'rows') row where row->>5='Posko Harapan' and row->>6 in ('Sukamaju','Cipandan'))<>2 then raise exception 'Missing separate Harapan shelters'; end if;
 if not exists(select 1 from jsonb_array_elements(d->'document'->'rows') row where row->>5='Posko Melati' and row->>6='Cisarua' and row->>21='{}') then raise exception 'Melati stock must be unknown'; end if;
 if not exists(select 1 from jsonb_array_elements(d->'document'->'rows') row where row->>5='Posko Pelita' and (row->>21)::jsonb->>'air_liter_per_hari'='0') then raise exception 'Pelita stock must be zero'; end if;
 if exists(select 1 from jsonb_array_elements(d->'document'->'rows') row where jsonb_array_length(row)<>jsonb_array_length(d->'document'->'header')) then raise exception 'Invalid row format'; end if;
 begin
  perform public.sigap_dispatch('storage.read',jsonb_build_object('actor_id',a,'context_id',cb));
  raise exception 'Cross-user read unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
 update public.sigap_storage set document=jsonb_set(document,'{rows,0,8}','123') where context_id=ca;
 if (select document->'rows'->0->>8 from public.sigap_storage where context_id=cb)<>'100' then raise exception 'Shared data changed'; end if;
 if has_function_privilege('anon','sigap_private.provision_test_registration()','EXECUTE') then raise exception 'Trigger function exposed'; end if;
end $$;
update sigap_private.test_registration_settings set enabled=false;
insert into auth.users(id,email) values('33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa','disabled@example.test');
do $$ begin
 if exists(select 1 from public.sigap_memberships where user_id='33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Disabled registration still provisioned'; end if;
end $$;
