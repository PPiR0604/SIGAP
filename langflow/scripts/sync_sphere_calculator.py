"""Review/update only the calculator code; optionally probe a private synthetic flow.

No shelter writer, publication, model provider or operational records are invoked.
Backups and live probe evidence stay in the ignored backend/data directory.
"""
import argparse
import copy
import gzip
import hashlib
import json
import urllib.request
import uuid
from pathlib import Path

from build_supabase_flows import code_for
from sync_storage_flows import embedded

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--flow-id', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    uuid.UUID(args.flow_id)
    settings = {}
    for line in (ROOT / '.env').read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            settings[key.strip()] = value.strip().strip('"\'')
    api_key = settings.get('LANGFLOW_API_KEY')
    if not api_key:
        raise ValueError('LANGFLOW_API_KEY is not configured.')

    def request(path, method='GET', payload=None):
        req = urllib.request.Request('http://127.0.0.1:7860' + path, method=method,
                                     data=json.dumps(payload).encode() if payload is not None else None,
                                     headers={'x-api-key': api_key, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity'})
        with urllib.request.urlopen(req, timeout=90) as response:
            raw = response.read()
        if not raw:
            return None
        return json.loads(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw)

    flow = request('/api/v1/flows/' + args.flow_id)
    nodes = [n for n in flow['data']['nodes'] if n['data']['node'].get('display_name') == 'Needs Gap Calculator']
    if len(nodes) != 1 or flow.get('name') != 'SIGAP - 3 Calculate Gap':
        raise ValueError('Selected flow is not the expected SIGAP calculator.')
    config = nodes[0]['data']['node']
    if 'sigap_context' not in config['template'] or '@authenticated_component' not in config['template']['code']['value']:
        raise ValueError('Expected authenticated calculator; refusing a storage/auth mode change.')
    new_code = code_for('needs_gap_calculator', ['build_needs_gap'])
    checksum = lambda value: hashlib.sha256(value.encode()).hexdigest()
    report = {'flow_id': flow['id'], 'flow_name': flow['name'], 'changed': checksum(new_code) != checksum(config['template']['code']['value'])}
    if not args.apply:
        print(json.dumps(report))
        return
    directory = ROOT / 'backend/data/langflow-backups' / ('sphere-' + uuid.uuid4().hex)
    directory.mkdir(parents=True)
    (directory / 'calculate_gap.before.json').write_text(json.dumps(flow, ensure_ascii=False), encoding='utf-8')

    if args.probe:
        fixture = json.loads((ROOT / 'frontend/tests/fixtures/spherePlanning.json').read_text(encoding='utf-8'))
        reference = {'snapshot_id': 'a' * 32, 'snapshot_sha256': 'b' * 64}
        # Private probe keeps the real graph/formatter, with a fixed synthetic source
        # inside this component method. It has no cloud transport or writer.
        probe_code = embedded('needs_gap_calculator')
        probe_code = probe_code.replace('    inputs = [', '    inputs = [\n        MessageTextInput(name="sigap_context", required=False),', 1)
        fixed = json.dumps(json.dumps({'records': [fixture['record']]}))
        probe_code = probe_code.replace('            snapshot = load_snapshot(data)',
            '            if data != ' + repr(reference) + ':\n                raise ValueError("Synthetic probe reference required.")\n            snapshot = json.loads(' + fixed + ')')
        data = copy.deepcopy(flow['data'])
        for node in data['nodes']:
            if node['data']['node'].get('display_name') == 'Needs Gap Calculator':
                node['data']['node']['template']['code']['value'] = probe_code
        # Give the probe independent vertex identities as well as an independent flow ID.
        encoded = json.dumps(data)
        suffix = '-probe' + uuid.uuid4().hex[:6]
        for node in data['nodes']:
            encoded = encoded.replace(node['id'], node['id'] + suffix)
        probe_name = 'SIGAP Sphere synthetic probe ' + uuid.uuid4().hex[:8]
        created = request('/api/v1/flows/', 'POST', {'name': probe_name, 'data': json.loads(encoded),
            'folder_id': flow['folder_id'], 'mcp_enabled': False, 'access_type': 'PRIVATE'})
        if created.get('name') != probe_name or created.get('mcp_enabled'):
            raise ValueError('Unexpected probe identity; no production flow was updated.')
        probe_id = str(uuid.UUID(created['id']))
        try:
            output = request('/api/v1/run/' + probe_id, 'POST', {'input_value': json.dumps(reference), 'input_type': 'chat', 'output_type': 'chat', 'session_id': 'sigap-sphere-probe-' + uuid.uuid4().hex})
            (directory / 'synthetic-run.json').write_text(json.dumps(output, ensure_ascii=False), encoding='utf-8')
            def texts(value):
                if isinstance(value, str):
                    yield value
                elif isinstance(value, dict):
                    for child in value.values():
                        yield from texts(child)
                elif isinstance(value, list):
                    for child in value:
                        yield from texts(child)
            parsed = []
            for text in texts(output):
                if '```json\n' in text:
                    try:
                        obj = json.loads(text.split('```json\n')[-1].split('\n```')[0])
                        if obj.get('snapshot_id') == reference['snapshot_id']:
                            parsed.append(obj)
                    except (ValueError, AttributeError):
                        pass
            if not parsed or parsed[0]['shelters'][0].get('planning') != fixture['calculation']['planning']:
                raise ValueError('Live synthetic calculator output differs from tested fixture.')
            report['live_synthetic_probe'] = 'passed'
        finally:
            request('/api/v1/flows/' + probe_id, 'DELETE')

    changed = copy.deepcopy(flow['data'])
    for node in changed['nodes']:
        if node['data']['node'].get('display_name') == 'Needs Gap Calculator':
            node['data']['node']['template']['code']['value'] = new_code
    request('/api/v1/flows/' + args.flow_id, 'PATCH', {'data': changed})
    verified = request('/api/v1/flows/' + args.flow_id)
    actual = next(n['data']['node']['template']['code']['value'] for n in verified['data']['nodes'] if n['data']['node'].get('display_name') == 'Needs Gap Calculator')
    if checksum(actual) != checksum(new_code) or verified['data']['edges'] != flow['data']['edges']:
        raise ValueError('Calculator update did not verify.')
    report.update(updated=True, code_sha256=checksum(actual), backup=str(directory))
    (directory / 'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
