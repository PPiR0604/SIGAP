"""Exercise the actual recovery SQL against an isolated, networkless fixture only.

Requires the bootstrapped sigap-recovery-fixture container. A gated storage view
pauses the recovery SELECT while a second connection commits storage + an event.
No production database, credentials, or application data are accessed.
"""
import json
import subprocess
import time

CONTAINER = 'sigap-recovery-fixture'
PSQL = ['docker', 'exec', CONTAINER, 'psql', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']


def sql(query):
    return subprocess.check_output(PSQL + ['-c', query], text=True, timeout=10).strip()


def wait_for(predicate):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.05)
    raise AssertionError('Fixture barrier was not reached')


def stop_gated_connections():
    sql("select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('sigap-recovery-gate','sigap-recovery-reader') and pid<>pg_backend_pid()")


gate = reader = None
try:
    sql("""
    insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
    insert into public.sigap_organizations(id,name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture');
    insert into public.sigap_contexts values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ctx','Fixture');
    insert into public.sigap_memberships(user_id,organization_id,role,status,scopes) values
      ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','petugas','active','{ctx}');
    insert into public.sigap_entities(kind,id,document) values
      ('sessions','mine','{"session_id":"mine","organization_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","context_id":"ctx","owner_user_id":"11111111-1111-4111-8111-111111111111"}'),
      ('events','before','{"session_id":"mine","event_id":12}');
    insert into public.sigap_storage(organization_id,context_id,revision,document) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ctx',0,'{"header":["jumlah_jiwa"],"rows":[["10"]]}');
    alter table public.sigap_storage rename to sigap_fixture_storage;
    create function public.sigap_fixture_hold(value jsonb) returns jsonb language plpgsql volatile as $$begin
      perform pg_advisory_lock(8080821); perform pg_advisory_unlock(8080821); return value;
    end$$;
    create view public.sigap_storage as select organization_id,context_id,revision,public.sigap_fixture_hold(document) as document from public.sigap_fixture_storage;
    """)
    gate = subprocess.Popen(PSQL + ['-c', "set application_name='sigap-recovery-gate';select pg_advisory_lock(8080821);select pg_sleep(50)"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    wait_for(lambda: sql("select count(*) from pg_stat_activity where application_name='sigap-recovery-gate' and wait_event='PgSleep'") == '1')
    args = {'actor_id': '11111111-1111-4111-8111-111111111111', 'context_id': 'ctx', 'recovery_session_id': 'mine', 'workspace_cutoff': '2026-11-09T00:00:00.000Z'}
    query = "select public.sigap_dispatch('storage.read','" + json.dumps(args) + "'::jsonb)"
    reader = subprocess.Popen(PSQL + ['-c', "set application_name='sigap-recovery-reader';" + query], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    wait_for(lambda: sql("select count(*) from pg_stat_activity where application_name='sigap-recovery-reader' and wait_event='advisory'") == '1')
    sql("""begin;
      update public.sigap_fixture_storage set revision=1,document='{"header":["jumlah_jiwa"],"rows":[["12"]]}' where context_id='ctx';
      insert into public.sigap_entities(kind,id,document) values('events','after','{"session_id":"mine","event_id":13}');
      commit;""")
    sql("select pg_terminate_backend(pid) from pg_stat_activity where application_name='sigap-recovery-gate'")
    output, errors = reader.communicate(timeout=8)
    assert reader.returncode == 0, errors
    first = json.loads(output)
    assert first['revision'] == 0 and first['document']['rows'] == [['10']], first
    assert first['recovery']['after_event_id'] == 12, first
    replay = json.loads(sql("select public.sigap_dispatch('entity.list','{\"kind\":\"events\",\"filter\":{\"session_id\":\"mine\"},\"after_event_id\":12}')"))
    assert [event['event_id'] for event in replay] == [13], replay
    second = json.loads(sql(query))
    assert second['revision'] == 1 and second['document']['rows'] == [['12']]
    assert second['recovery']['after_event_id'] == 13
    print(json.dumps({'isolated_fixture': True, 'same_snapshot_storage_and_cursor': True, 'concurrent_commit_replayed': True, 'next_recovery_sees_commit': True}))
finally:
    stop_gated_connections()
    for process in (gate, reader):
        if process:
            process.communicate(timeout=5)
