import asyncio
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import httpx

from .config import Settings, TOOLS


class BootstrapError(RuntimeError):
    pass


def validate_flows(directory):
    flows = []
    for endpoint in TOOLS:
        flow = json.loads((directory / (endpoint + '.json')).read_text(encoding='utf-8'))
        if flow.get('endpoint_name') != endpoint or not flow.get('mcp_enabled'):
            raise BootstrapError('Flow endpoint or MCP flag is invalid: ' + endpoint)
        protected = 0
        for node in flow['data']['nodes']:
            template = node.get('data', {}).get('node', {}).get('template', {})
            code = template.get('code', {}).get('value', '')
            if code and node['data']['node'].get('display_name') not in ('Chat Input', 'Chat Output', 'Prompt Template', 'Google Workspace Webhook'):
                if not template.get('sigap_context') or '@authenticated_component' not in code:
                    raise BootstrapError('Unprotected custom component: ' + endpoint)
                protected += 1
            for field in template.values():
                if isinstance(field, dict) and (field.get('password') or field.get('_input_type') == 'SecretStrInput') and field.get('value'):
                    raise BootstrapError('Flow export contains a configured secret: ' + endpoint)
        if not protected:
            raise BootstrapError('Flow has no authenticated execution component: ' + endpoint)
        # Exclude export metadata and imported users, IDs and local paths from the API body.
        flows.append({k: flow[k] for k in ('name', 'description', 'data', 'endpoint_name', 'action_name', 'action_description', 'mcp_enabled') if k in flow})
    return flows


async def json_request(client, method, path, **kwargs):
    response = await client.request(method, path, **kwargs)
    if not response.is_success:
        raise BootstrapError(f'Langflow bootstrap rejected {method} {path} (HTTP {response.status_code}).')
    return response.json()


async def bootstrap(client, settings, flows):
    # This is the private Langflow service account, not an application/admin user in Supabase.
    login = await json_request(client, 'POST', '/api/v1/login', data={'username': settings.superuser, 'password': settings.password})
    headers = {'Authorization': 'Bearer ' + login['access_token']}
    # A login cookie must not make an invalid transport API key appear valid.
    client.cookies.clear()
    # Langflow generates API keys itself; its create endpoint ignores caller-supplied keys.
    # Keep this private key distinct from the public proxy transport key.
    key_listing = await json_request(client, 'GET', '/api/v1/api_key/', headers=headers)
    keys = key_listing.get('api_keys', [])
    for key in keys:
        if key.get('name') == 'sigap-mcp-internal':
            response = await client.delete('/api/v1/api_key/' + key['id'], headers=headers)
            if not response.is_success:
                raise BootstrapError('Previous internal MCP key could not be rotated.')
    created_key = await json_request(client, 'POST', '/api/v1/api_key/', headers=headers,
                                     json={'name': 'sigap-mcp-internal'})
    internal_key = created_key.get('api_key')
    if not isinstance(internal_key, str) or not internal_key:
        raise BootstrapError('Internal MCP key was not created.')
    projects = await json_request(client, 'GET', '/api/v1/projects/', headers=headers)
    matches = [p for p in projects if p['name'] == 'SIGAP-MCP']
    if len(matches) > 1:
        raise BootstrapError('Ambiguous SIGAP MCP project.')
    project = matches[0] if matches else await json_request(client, 'POST', '/api/v1/projects/', headers=headers,
                            json={'name': 'SIGAP-MCP', 'description': 'Authenticated SIGAP workflow tools', 'auth_settings': {'auth_type': 'apikey'}})
    project_id = project['id']
    # Explicit project auth also covers a previously created runtime project.
    await json_request(client, 'PATCH', '/api/v1/projects/' + project_id, headers=headers,
                       json={'auth_settings': {'auth_type': 'apikey'}})
    existing = await json_request(client, 'GET', '/api/v1/flows/?get_all=true', headers=headers)
    for flow in flows:
        matching = [f for f in existing if f.get('folder_id') == project_id and f.get('endpoint_name') == flow['endpoint_name']]
        if len(matching) > 1:
            raise BootstrapError('Duplicate SIGAP endpoint.')
        payload = dict(flow, folder_id=project_id, access_type='PRIVATE')
        if matching:
            await json_request(client, 'PATCH', '/api/v1/flows/' + matching[0]['id'], headers=headers, json=payload)
        else:
            await json_request(client, 'POST', '/api/v1/flows/', headers=headers, json=payload)
    # Drop login/refresh cookies before proxying; the transport must never use admin authentication.
    client.cookies.clear()
    return project_id, internal_key


def rpc_result(response, identifier):
    if not response.is_success:
        raise BootstrapError('MCP handshake failed (HTTP ' + str(response.status_code) + ').')
    if 'text/event-stream' in response.headers.get('content-type', ''):
        for frame in re.split(r'\r?\n\r?\n', response.text):
            data = '\n'.join(line[5:].lstrip() for line in frame.splitlines() if line.startswith('data:'))
            if data:
                value = json.loads(data)
                if value.get('id') == identifier:
                    break
        else:
            raise BootstrapError('MCP handshake has no matching response.')
    else:
        value = response.json()
    if value.get('id') != identifier or 'error' in value or 'result' not in value:
        raise BootstrapError('Invalid MCP handshake result.')
    return value['result']


async def verify_tools(client, settings, project_id, api_key=None):
    path = '/api/v1/mcp/project/' + project_id + '/streamable'
    headers = {'x-api-key': api_key or settings.api_key, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
    init = await client.post(path, headers=headers, json={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                            'params': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'sigap-deploy-check', 'version': '1'}}})
    protocol = rpc_result(init, 1)['protocolVersion']
    headers['MCP-Protocol-Version'] = protocol
    if init.headers.get('mcp-session-id'):
        headers['Mcp-Session-Id'] = init.headers['mcp-session-id']
    await client.post(path, headers=headers, json={'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}})
    listed = await client.post(path, headers=headers, json={'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
    tools = rpc_result(listed, 2).get('tools', [])
    actual = [re.sub(r'^sigap_\d+_', '', tool.get('name', '')) for tool in tools]
    if len(actual) != len(TOOLS) or set(actual) != set(TOOLS):
        raise BootstrapError('MCP did not expose exactly the seven SIGAP tools.')
    if headers.get('Mcp-Session-Id'):
        await client.delete(path, headers=headers)
    return len(tools)


class ManagedLangflow:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.process = None
        self.ready = False
        self.project_id = None
        self.internal_api_key = None
        self.failure = None
        self.phase = 'starting'

    async def start(self):
        settings = self.settings
        flows = validate_flows(settings.flows_dir)
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        # Hosting providers generate arbitrary random strings; Langflow expects a Fernet key.
        encryption_key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest()).decode()
        env = dict(os.environ, LANGFLOW_AUTO_LOGIN='false', LANGFLOW_SUPERUSER=settings.superuser,
                   LANGFLOW_SUPERUSER_PASSWORD=settings.password, LANGFLOW_SECRET_KEY=encryption_key,
                   LANGFLOW_CONFIG_DIR=str(settings.data_dir), LANGFLOW_DATABASE_URL='sqlite:///' + (settings.data_dir / 'runtime.db').resolve().as_posix(),
                   LANGFLOW_LOAD_FLOWS_PATH='', LANGFLOW_ADD_PROJECTS_TO_MCP_SERVERS='false',
                   LANGFLOW_SKIP_MCP_AUTO_INIT='true', LANGFLOW_MCP_COMPOSER_ENABLED='false', LANGFLOW_MCP_SSE_ENABLED='false',
                   SIGAP_BACKEND_INTERNAL_URL=settings.backend, DO_NOT_TRACK='true', LANGFLOW_CORS_ORIGINS='[]')
        env['LANGFLOW_CUSTOM_COMPONENT_ADMIN_ONLY'] = 'true'
        env.pop('LANGFLOW_API_KEY', None)
        command = [sys.executable, '-m', 'langflow', 'run', '--backend-only', '--no-open-browser',
                   '--host', '127.0.0.1', '--port', str(settings.internal_port), '--workers', '1']
        self.process = subprocess.Popen(command, env=env, cwd=settings.data_dir,
                                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            async with asyncio.timeout(settings.timeout), httpx.AsyncClient(base_url=settings.upstream, timeout=120, follow_redirects=False, trust_env=False) as client:
                self.phase = 'langflow_health'
                deadline = time.monotonic() + settings.timeout
                while time.monotonic() < deadline:
                    if self.process.poll() is not None:
                        raise BootstrapError('Langflow process exited before readiness.')
                    try:
                        response = await client.get('/health', timeout=3)
                        if response.is_success:
                            break
                    except httpx.RequestError:
                        pass
                    await asyncio.sleep(1)
                else:
                    raise BootstrapError('Langflow startup timed out.')
                self.phase = 'import_flows'
                self.project_id, self.internal_api_key = await bootstrap(client, settings, flows)
                self.phase = 'verify_tools'
                await verify_tools(client, settings, self.project_id, self.internal_api_key)
                # Callback is needed for every scoped data operation. A non-healthy callback must not produce a ready MCP.
                async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as callback:
                    self.phase = 'backend_health'
                    health = await callback.get(settings.backend + '/api/health')
                    if not health.is_success or health.json().get('status') != 'ok':
                        raise BootstrapError('SIGAP authentication backend is not reachable.')
            self.ready = True
            self.phase = 'ready'
            while self.process.poll() is None:
                await asyncio.sleep(1)
            raise BootstrapError('Langflow process exited.')
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.failure = 'MCP_BOOTSTRAP_FAILED'
            self.failure_detail = str(exc) if isinstance(exc, BootstrapError) else type(exc).__name__
            raise
        finally:
            self.ready = False

    async def stop(self):
        self.ready = False
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                await asyncio.to_thread(self.process.wait, 15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                await asyncio.to_thread(self.process.wait)
