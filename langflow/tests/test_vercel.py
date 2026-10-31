import asyncio
import json
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from deploy.app import create_app
from deploy.config import Settings
from deploy.partition_image import partition
from test_deploy import FakeRuntime, settings


class VercelConfigTests(unittest.TestCase):
    def test_vercel_forces_stateless_https_and_bounded_cold_start(self):
        env = {'VERCEL': '1', 'LANGFLOW_API_KEY': 'a' * 40, 'LANGFLOW_SUPERUSER_PASSWORD': 'b' * 32,
               'LANGFLOW_SECRET_KEY': 'c' * 40, 'SIGAP_BACKEND_INTERNAL_URL': 'https://api.example.test',
               'SIGAP_MCP_STATELESS': '0'}
        config = Settings.from_env(env)
        self.assertTrue(config.stateless)
        self.assertEqual(config.timeout, 150)
        with self.assertRaises(ValueError):
            Settings.from_env(dict(env, SIGAP_MCP_STARTUP_TIMEOUT_SECONDS='600'))
        with self.assertRaises(ValueError):
            Settings.from_env(dict(env, SIGAP_BACKEND_INTERNAL_URL='http://localhost:8787', SIGAP_MCP_ALLOW_LOCAL_BACKEND='1'))

    def test_image_partition_preserves_files_and_bounds_layers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'vendor'
            (source / 'nested').mkdir(parents=True)
            (source / 'nested' / 'empty').mkdir()
            for index in range(8):
                (source / 'nested' / str(index)).write_bytes(bytes([index]) * 3000)
            sizes = partition(source, root / 'parts', parts=4, limit=12000, excluded=set())
            self.assertTrue(all(size <= 12000 for size in sizes))
            for original in (source / 'nested').iterdir():
                if original.is_file():
                    matches = list((root / 'parts').glob('part*/nested/' + original.name))
                    self.assertEqual(len(matches), 1)
                    self.assertEqual(matches[0].read_bytes(), original.read_bytes())
            self.assertTrue((root / 'parts' / 'part00' / 'nested' / 'empty').is_dir())


class EndlessSSE(httpx.AsyncByteStream):
    closed = False

    async def __aiter__(self):
        yield b'data: {"jsonrpc":"2.0","method":"notifications/message"}\n\n'
        yield b'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n'
        await asyncio.Future()

    async def aclose(self):
        self.closed = True


class StatelessTests(unittest.IsolatedAsyncioTestCase):
    async def test_initialize_and_tool_call_can_land_on_different_instances(self):
        config = replace(settings(), stateless=True)
        sessions, invocations, deleted = set(), [], []
        def transport(label):
            def handle(request):
                self.assertEqual(request.headers['x-api-key'], 'private-generated-key')
                self.assertNotIn('cookie', request.headers)
                self.assertNotIn('authorization', request.headers)
                if request.method == 'DELETE':
                    self.assertEqual(request.headers['mcp-protocol-version'], '2025-03-26')
                    deleted.append(request.headers['mcp-session-id'])
                    sessions.remove(request.headers['mcp-session-id'])
                    return httpx.Response(200)
                payload = json.loads(request.content)
                if payload['method'] == 'initialize':
                    session = label + '-' + str(len(deleted))
                    sessions.add(session)
                    return httpx.Response(200, json={'jsonrpc': '2.0', 'id': payload['id'], 'result': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'serverInfo': {'name': 'Langflow', 'version': 'fixture'}}},
                                          headers={'mcp-session-id': session, 'set-cookie': 'admin=private'})
                self.assertIn(request.headers['mcp-session-id'], sessions)
                if payload['method'] == 'notifications/initialized':
                    return httpx.Response(202)
                invocations.append(payload)
                return httpx.Response(200, json={'jsonrpc': '2.0', 'id': payload['id'], 'result': {'content': [{'type': 'text', 'text': 'fixture result'}]}})
            return httpx.MockTransport(handle)
        first = create_app(config, FakeRuntime(), transport('replica-a'))
        second = create_app(config, FakeRuntime(), transport('replica-b'))
        async with first.router.lifespan_context(first), second.router.lifespan_context(second):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=first), base_url='http://a') as a, httpx.AsyncClient(transport=httpx.ASGITransport(app=second), base_url='http://b') as b:
                headers = {'x-api-key': config.api_key}
                init = await a.post('/mcp', headers=headers, json={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}})
                self.assertEqual(init.status_code, 200)
                self.assertNotIn('mcp-session-id', init.headers)
                self.assertNotIn('set-cookie', init.headers)
                await b.post('/mcp', headers=headers, json={'jsonrpc': '2.0', 'method': 'notifications/initialized'})
                payload = {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'fetch_shelters', 'arguments': {'input_value': '{"__sigap_context":"signed-fixture","input":"source"}'}}}
                result = await b.post('/mcp', headers=dict(headers, cookie='admin=ignored', authorization='Bearer ignored', **{'mcp-session-id': 'untrusted-public-session'}), json=payload)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(invocations, [payload])
                self.assertEqual(sessions, set())
                self.assertEqual(len(deleted), 2)
                self.assertEqual((await b.get('/mcp', headers=headers)).status_code, 405)
                self.assertEqual((await b.delete('/mcp', headers=headers)).status_code, 204)
                self.assertEqual((await b.post('/mcp', headers=headers, json=[])).status_code, 400)

    async def test_open_sse_stops_after_matching_response(self):
        from deploy.stateless import exchange
        stream = EndlessSSE()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=stream)), base_url='http://private') as client:
            value, _ = await asyncio.wait_for(exchange(client, '/mcp', {}, {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}), timeout=1)
        self.assertEqual(value['result'], {'tools': []})
        self.assertTrue(stream.closed)

    async def test_private_initialization_error_keeps_public_request_id(self):
        config = replace(settings(), stateless=True)
        def handler(request):
            payload = json.loads(request.content)
            return httpx.Response(200, json={'jsonrpc': '2.0', 'id': payload['id'], 'error': {'code': -32602, 'message': 'Unsupported protocol'}})
        app = create_app(config, FakeRuntime(), httpx.MockTransport(handler))
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/mcp', headers={'x-api-key': config.api_key}, json={'jsonrpc': '2.0', 'id': 99, 'method': 'tools/list'})
        self.assertEqual(response.json()['id'], 99)
        self.assertEqual(response.json()['error']['code'], -32602)

    async def test_uncertain_write_is_never_replayed(self):
        config = replace(settings(), stateless=True)
        attempts = []
        def handler(request):
            if request.method == 'DELETE':
                return httpx.Response(200)
            payload = json.loads(request.content)
            if payload['method'] == 'initialize':
                return httpx.Response(200, json={'jsonrpc': '2.0', 'id': payload['id'], 'result': {'protocolVersion': '2025-03-26'}}, headers={'mcp-session-id': 'private'})
            if payload['method'] == 'notifications/initialized':
                return httpx.Response(202)
            attempts.append(payload['method'])
            raise httpx.ReadTimeout('fixture timeout')
        app = create_app(config, FakeRuntime(), httpx.MockTransport(handler))
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            result = await client.post('/mcp', headers={'x-api-key': config.api_key}, json={'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'upsert_shelter', 'arguments': {}}})
        self.assertEqual(result.status_code, 502)
        self.assertEqual(attempts, ['tools/call'])

    async def test_first_request_waits_for_cold_start(self):
        class ColdRuntime(FakeRuntime):
            ready = False
            async def start(self):
                await asyncio.sleep(0.01)
                self.ready = True
                await asyncio.Future()
        app = create_app(replace(settings(), stateless=True, timeout=30), ColdRuntime())
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            self.assertEqual((await client.get('/health')).status_code, 200)


if __name__ == '__main__':
    unittest.main()
