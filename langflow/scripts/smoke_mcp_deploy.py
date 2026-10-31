"""Opt-in local deployment smoke test. Uses an isolated Langflow control DB, no Supabase users."""
import asyncio
import json
import secrets
import socket
import sys
import tempfile
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy.config import Settings
from deploy.runtime import ManagedLangflow, rpc_result
from deploy.app import create_app


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


async def main():
    with tempfile.TemporaryDirectory(prefix='sigap-deploy-smoke-', ignore_cleanup_errors=True) as directory:
        config = Settings(api_key=secrets.token_hex(32), password=secrets.token_hex(32),
                          superuser='sigap-smoke', secret_key=secrets.token_hex(32),
                          backend='http://127.0.0.1:8787', port=free_port(),
                          internal_port=free_port(), data_dir=Path(directory), timeout=600)
        runtime = ManagedLangflow(config)
        app = create_app(config, runtime)
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', timeout=120) as client:
            deadline = time.monotonic() + 660
            while not runtime.ready and not runtime.failure and time.monotonic() < deadline:
                await asyncio.sleep(1)
            if not runtime.ready:
                raise RuntimeError('Isolated Langflow deployment did not become ready during ' + runtime.phase + ': ' + getattr(runtime, 'failure_detail', 'timeout'))
            assert (await client.get('/health')).status_code == 200
            assert (await client.post('/mcp', json={})).status_code == 401
            headers = {'x-api-key': config.api_key, 'accept': 'application/json, text/event-stream'}
            init = await client.post('/mcp', headers=headers, json={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
                'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'sigap-smoke', 'version': '1'}}})
            headers['mcp-protocol-version'] = rpc_result(init, 1)['protocolVersion']
            if init.headers.get('mcp-session-id'):
                headers['mcp-session-id'] = init.headers['mcp-session-id']
            await client.post('/mcp', headers=headers, json={'jsonrpc': '2.0', 'method': 'notifications/initialized'})
            response = await client.post('/mcp', headers=headers, json={'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
            tools = rpc_result(response, 2)['tools']
            assert len(tools) == 7
            fetch = next(tool for tool in tools if tool['name'].endswith('fetch_shelters'))
            unsigned = await client.post('/mcp', headers=headers, json={'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
                'params': {'name': fetch['name'], 'arguments': {'input_value': 'read shelter data'}}})
            result = rpc_result(unsigned, 3)
            assert 'signed login context' in json.dumps(result), 'Unsigned tool call must fail at the authentication boundary.'
            print('SMOKE OK: isolated startup, seven tools, public proxy auth and unsigned execution rejection.', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
