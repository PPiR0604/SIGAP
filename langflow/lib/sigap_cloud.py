"""Scoped Supabase transport. Capabilities arrive from the authenticated backend, never the LLM."""
import contextvars
import functools
import hashlib
import json
import os
import re
import secrets
import tempfile
import time
import urllib.request
from pathlib import Path

_cloud_capability = contextvars.ContextVar('sigap_cloud_capability', default=None)

def cloud_request(action, args=None):
    cap = _cloud_capability.get()
    if not cap:
        raise ValueError('Authenticated backend capability is required.')
    # The deployment injects this fixed backend URL, never a URL from model/tool input.
    url = os.environ.get('SIGAP_BACKEND_INTERNAL_URL', 'http://127.0.0.1:8787') + '/api/internal/langflow'
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    request = urllib.request.Request(url, data=json.dumps({'action': action, 'args': args or {}}, ensure_ascii=False).encode(),
        headers={'Content-Type': 'application/json', 'x-sigap-capability': cap}, method='POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            return json.loads(response.read(8 * 1024 * 1024))['data']
    except Exception:
        raise ValueError('Supabase operation rejected or unavailable. No fallback storage.') from None

def authenticated_component(method):
    @functools.wraps(method)
    def guarded(self, *args, **kwargs):
        raw = getattr(self, 'sigap_context', '')
        raw = raw.text if hasattr(raw, 'text') else str(raw or '')
        try:
            envelope = json.loads(raw)
            cap = envelope['__sigap_context']
            if not isinstance(cap, str) or len(cap) > 16384:
                raise ValueError()
        except Exception:
            raise ValueError('SIGAP requires a signed login context from the backend.') from None
        # Every custom node receives the original Chat Input on this separate connection.
        # Only unwrap actual source input fields, never put the capability into a model prompt.
        for field in ('raw_text', 'payload', 'records_json', 'query', 'content', 'input_value'):
            value = getattr(self, field, None)
            text = value.text if hasattr(value, 'text') else str(value or '')
            if text == raw:
                setattr(self, field, envelope['input'])
        token = _cloud_capability.set(cap)
        try:
            return method(self, *args, **kwargs)
        finally:
            _cloud_capability.reset(token)
    return guarded

def cloud_scope():
    cap = _cloud_capability.get()
    if not cap:
        raise ValueError('Missing authenticated context.')
    import base64
    # Decoding selects a namespace only; backend verifies its signature and live membership.
    claims = json.loads(base64.urlsafe_b64decode(cap.split('.')[0] + '==='))
    return 'supabase://' + claims['organization_id'] + '/' + claims['context_id']

def cloud_save_snapshot(payload):
    identifier = secrets.token_hex(16)
    digest = snapshot_digest(payload)
    cloud_request('flow.save', {'id': identifier, 'envelope': {'created_at': time.time(), 'sha256': digest, 'payload': payload}})
    return {'snapshot_id': identifier, 'snapshot_sha256': digest}

def cloud_load_snapshot(request):
    if not isinstance(request, dict) or not re.fullmatch('[a-f0-9]{32}', str(request.get('snapshot_id', ''))):
        raise ValueError('Use a server-issued snapshot reference.')
    if any(k in request for k in ('records', 'stock', 'stock_context', 'snapshot_records')):
        raise ValueError('Free records cannot replace a snapshot.')
    result = cloud_request('flow.load', {'id': request['snapshot_id']})
    if not result or result.get('committed_reference'):
        raise ValueError('Snapshot is missing, outside scope or superseded. Read back current data.')
    envelope = result['envelope']
    if time.time() - envelope['created_at'] > 86400:
        raise ValueError('Snapshot expired.')
    if snapshot_digest(envelope['payload']) != envelope['sha256'] or request.get('snapshot_sha256') != envelope['sha256']:
        raise ValueError('Snapshot hash mismatch.')
    return envelope['payload']

def cloud_commit_snapshot(original, effective, storage):
    cloud_load_snapshot(original)
    payload = dict(effective, snapshot_kind='committed', parent_snapshot=original, storage=storage)
    reference = cloud_save_snapshot(payload)
    if not cloud_request('flow.commit', {'id': original['snapshot_id'], 'reference': reference}):
        raise ValueError('Commit reference changed. Read back, do not retry write.')
    return reference

def cloud_read_storage(path=None):
    result = cloud_request('storage.read')
    document = result['document']
    return {**document, 'count': len(document['rows']), 'path': cloud_scope(), 'revision': result['revision']}

def cloud_write_storage(payload, path, match, merge, *, migration=False):
    if migration:
        raise ValueError('Administrative migration must use the separate reviewed importer.')
    approved = payload.get('approved_write')
    if not approved:
        raise ValueError('Explicit officer approval is required.')
    digest = hashlib.sha256(json.dumps({k: payload.get(k) for k in ('header','rows','clear_columns','update_targets')}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    commit_key = json.dumps(approved['source_snapshot'], sort_keys=True)
    receipt = cloud_request('storage.receipt', {'commit_key': commit_key, 'request_hash': digest, 'source_snapshot': approved['source_snapshot']})
    if receipt:
        return receipt
    stored = cloud_read_storage()
    document = {'header': stored['header'], 'rows': stored['rows']}
    scoped_payload = json.loads(json.dumps(payload))
    original_records = scoped_payload['approved_write']['effective_payload']['records']
    for record in original_records:
        source = record.get('storage_source')
        if not source or source.get('mode') != 'supabase' or source.get('path') != cloud_scope():
            raise ValueError('Write scope differs from the reviewed source.')
    # Reuse the existing merge/baseline validator in disposable scratch space.
    # Supabase is the authoritative store; CAS commits rows, history and receipt atomically.
    with tempfile.TemporaryDirectory(prefix='sigap-merge-') as directory:
        local = str(Path(directory) / 'scratch.db')
        with connect_storage(local) as db:
            db.execute('insert into storage_meta values(?,?)', ('header', json.dumps(document['header'])))
            for row in document['rows']:
                key = identity_for(document['header'], row, allow_incomplete=True)
                version = int(row[document['header'].index('versi')] or 1) if 'versi' in document['header'] else 1
                db.execute('insert into shelters values(?,?,?)', (key, json.dumps(row), version))
        for record in original_records:
            record['storage_source'] = {'mode': 'sqlite', 'path': local}
        result = _local_write_storage(scoped_payload, local, match, merge)
        after = _local_read_storage(local)
    result['path'] = cloud_scope()
    return cloud_request('storage.commit', {'revision': stored['revision'], 'document': {'header': after['header'], 'rows': after['rows']},
        'request_hash': digest, 'commit_key': commit_key,
        'source_snapshot': approved['source_snapshot'], 'result': result})
