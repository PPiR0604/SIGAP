"""Deployment boundary tests; no live account, database or model calls."""
import asyncio
import json
import sys
import unittest
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from deploy.config import Settings, TOOLS
from deploy.runtime import bootstrap, validate_flows, verify_tools
from deploy.app import create_app, MAX_BODY


def settings():
    return Settings.from_env({'LANGFLOW_API_KEY': 'a' * 40, 'LANGFLOW_SUPERUSER_PASSWORD': 'b' * 32,
                              'LANGFLOW_SECRET_KEY': 'c' * 40, 'SIGAP_BACKEND_INTERNAL_URL': 'https://api.example.test'})


class ConfigTests(unittest.TestCase):
    def test_required_secrets_and_https_callback(self):
        with self.assertRaises(ValueError):
            Settings.from_env({})
        env = {'LANGFLOW_API_KEY': 'a' * 40, 'LANGFLOW_SUPERUSER_PASSWORD': 'b' * 32,
               'LANGFLOW_SECRET_KEY': 'c' * 40}
        for url in ('http://api.example.test', 'https://user:password@api.example.test',
                    'https://api.example.test/path', 'https://api.example.test?key=secret', 'https://localhost:8787'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                Settings.from_env(dict(env, SIGAP_BACKEND_INTERNAL_URL=url))
        debug = dict(env, SIGAP_BACKEND_INTERNAL_URL='http://localhost:8787', SIGAP_MCP_ALLOW_LOCAL_BACKEND='1')
        self.assertEqual(Settings.from_env(debug).backend, 'http://localhost:8787')
        with self.assertRaises(ValueError):
            Settings.from_env(dict(debug, RENDER='true'))

    def test_secure_exports_have_exact_expected_endpoints(self):
        flows = validate_flows(settings().flows_dir)
        self.assertEqual({f['endpoint_name'] for f in flows}, set(TOOLS))
        self.assertTrue(all('id' not in f and f['mcp_enabled'] for f in flows))


class FakeRuntime:
    ready = True
    failure = None
    project_id = 'fixture-project'
    internal_api_key = 'private-generated-key'

    async def start(self):
        await asyncio.Future()

    async def stop(self):
        pass


class ProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_boundary_and_streaming_headers(self):
        observed = []
        def handler(request):
            observed.append(request)
            return httpx.Response(200, content=b'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
                                  headers={'content-type': 'text/event-stream', 'mcp-session-id': 'session-fixture',
                                           'set-cookie': 'admin=secret', 'location': 'https://private.example.test'})
        config = settings()
        app = create_app(config, FakeRuntime(), httpx.MockTransport(handler))
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            self.assertEqual((await client.get('/health')).status_code, 200)
            for path in ('/api/v1/login', '/api/v1/flows/', '/docs', '/openapi.json'):
                self.assertEqual((await client.get(path)).status_code, 404)
            self.assertEqual((await client.post('/mcp', json={})).status_code, 401)
            headers = {'x-api-key': config.api_key}
            self.assertEqual((await client.post('/mcp', headers=dict(headers, origin='https://evil.example.test'))).status_code, 403)
            self.assertEqual((await client.post('/mcp?key=secret', headers=headers)).status_code, 400)
            self.assertEqual((await client.post('/mcp', headers=headers, content=b'x' * (MAX_BODY + 1))).status_code, 413)
            response = await client.post('/mcp', headers=dict(headers, authorization='Bearer ignored', cookie='admin=ignored', **{'mcp-session-id': 'fixture'}), json={'id': 1})
            self.assertEqual(response.status_code, 200)
            self.assertIn('data:', response.text)
            self.assertEqual(response.headers['mcp-session-id'], 'session-fixture')
            self.assertNotIn('set-cookie', response.headers)
            self.assertNotIn('location', response.headers)
            self.assertEqual(len(observed), 1)
            self.assertEqual(observed[0].url.path, '/api/v1/mcp/project/fixture-project/streamable')
            self.assertNotIn('authorization', observed[0].headers)
            self.assertNotIn('cookie', observed[0].headers)
            self.assertEqual(observed[0].headers['mcp-session-id'], 'fixture')
            self.assertEqual(observed[0].headers['x-api-key'], 'private-generated-key')
            self.assertNotEqual(observed[0].headers['x-api-key'], config.api_key)

    async def test_readiness_and_redirect_denial(self):
        runtime = FakeRuntime()
        runtime.ready = False
        config = settings()
        app = create_app(config, runtime, httpx.MockTransport(lambda request: httpx.Response(307, headers={'location': 'https://other.example.test'})))
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            self.assertEqual((await client.get('/health')).status_code, 503)
            self.assertEqual((await client.post('/mcp', headers={'x-api-key': config.api_key})).status_code, 503)
            runtime.ready = True
            response = await client.post('/mcp', headers={'x-api-key': config.api_key})
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('location', response.headers)


class BootstrapTests(unittest.IsolatedAsyncioTestCase):
    async def test_bootstrap_is_idempotent_and_internal_key_is_generated_then_rotated(self):
        config = settings()
        state = {'keys': [], 'project': None, 'flows': [], 'created': 0, 'rotated': 0}
        def handler(request):
            path = request.url.path
            payload = json.loads(request.content) if request.content and request.headers.get('content-type', '').startswith('application/json') else {}
            if path == '/api/v1/login':
                return httpx.Response(200, json={'access_token': 'private-admin'}, headers={'set-cookie': 'access_token=private-admin; Path=/'})
            self.assertNotIn('cookie', request.headers)
            self.assertEqual(request.headers.get('authorization'), 'Bearer private-admin')
            if path == '/api/v1/api_key/':
                if request.method == 'GET':
                    return httpx.Response(200, json={'api_keys': state['keys'], 'total_count': len(state['keys'])})
                self.assertNotIn('api_key', payload)
                key = {'id': 'generated-key-id', 'name': payload['name'], 'api_key': 'server-generated-key'}
                state['keys'].append(key)
                return httpx.Response(200, json=key)
            if path == '/api/v1/api_key/generated-key-id':
                state['keys'].clear()
                state['rotated'] += 1
                return httpx.Response(204)
            if path == '/api/v1/projects/':
                if request.method == 'GET':
                    return httpx.Response(200, json=[state['project']] if state['project'] else [])
                state['project'] = {'id': 'fixture-project', **payload}
                return httpx.Response(200, json=state['project'])
            if path == '/api/v1/projects/fixture-project':
                self.assertEqual(payload['auth_settings'], {'auth_type': 'apikey'})
                return httpx.Response(200, json=state['project'])
            if path == '/api/v1/flows/' and request.method == 'GET':
                return httpx.Response(200, json=state['flows'])
            self.assertEqual(payload['access_type'], 'PRIVATE')
            if request.method == 'POST':
                state['created'] += 1
                state['flows'].append(dict(payload, id=str(state['created'])))
            return httpx.Response(200, json=payload)
        async with httpx.AsyncClient(base_url=config.upstream, transport=httpx.MockTransport(handler)) as client:
            flows = validate_flows(config.flows_dir)
            self.assertEqual(await bootstrap(client, config, flows), ('fixture-project', 'server-generated-key'))
            await bootstrap(client, config, flows)
        self.assertEqual(state['created'], 7)
        self.assertEqual(state['rotated'], 1)
        self.assertEqual(len(state['keys']), 1)

    async def test_tools_verified_via_mcp_handshake(self):
        config = settings()
        def handler(request):
            if request.method == 'DELETE':
                return httpx.Response(200)
            body = json.loads(request.content)
            if body['method'] == 'notifications/initialized':
                return httpx.Response(202)
            if body['method'] == 'initialize':
                return httpx.Response(200, json={'jsonrpc': '2.0', 'id': 1, 'result': {'protocolVersion': '2025-03-26'}}, headers={'mcp-session-id': 'fixture'})
            self.assertEqual(request.headers['mcp-session-id'], 'fixture')
            result = {'jsonrpc': '2.0', 'id': 2, 'result': {'tools': [{'name': 'sigap_' + str(i) + '_' + name} for i, name in enumerate(TOOLS)]}}
            return httpx.Response(200, text='event: message\ndata: ' + json.dumps(result) + '\n\n', headers={'content-type': 'text/event-stream'})
        async with httpx.AsyncClient(base_url=config.upstream, transport=httpx.MockTransport(handler)) as client:
            self.assertEqual(await verify_tools(client, config, 'fixture-project'), 7)


if __name__ == '__main__':
    unittest.main()
