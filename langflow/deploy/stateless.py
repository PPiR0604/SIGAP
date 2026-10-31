"""Each public RPC owns a fresh private Langflow session; no replica affinity or write retries."""
import asyncio
import json
from contextlib import suppress

import httpx
from starlette.responses import JSONResponse, Response

MAX_RESPONSE = 8 * 1024 * 1024
NO_STORE = {'cache-control': 'no-store'}


class RpcError(RuntimeError):
    pass


def matching(value, identifier):
    return isinstance(value, dict) and type(value.get('id')) is type(identifier) and value.get('id') == identifier


async def exchange(client, path, headers, payload):
    identifier = payload['id']
    async with client.stream('POST', path, headers=headers, json=payload) as response:
        if not response.is_success:
            raise RpcError('Upstream MCP rejected the request.')
        session = response.headers.get('mcp-session-id')
        if 'text/event-stream' in response.headers.get('content-type', ''):
            # Stop at the matching frame even when upstream keeps its SSE stream open.
            size, lines = 0, []
            async for line in response.aiter_lines():
                size += len(line.encode())
                if size > MAX_RESPONSE:
                    raise RpcError('Upstream response too large.')
                if line.startswith('data:'):
                    lines.append(line[5:].lstrip())
                elif not line and lines:
                    value = json.loads('\n'.join(lines))
                    lines = []
                    if matching(value, identifier):
                        if value.get('jsonrpc') != '2.0':
                            raise RpcError('Invalid MCP response.')
                        return value, session
            raise RpcError('No matching MCP response.')
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_RESPONSE:
                raise RpcError('Upstream response too large.')
            chunks.append(chunk)
        value = json.loads(b''.join(chunks))
        if not matching(value, identifier) or value.get('jsonrpc') != '2.0':
            raise RpcError('Invalid MCP response.')
        return value, session


async def invoke_stateless(request, body, managed, client):
    if request.method == 'GET':
        return Response(status_code=405, headers={**NO_STORE, 'allow': 'POST, DELETE'})
    if request.method == 'DELETE':
        return Response(status_code=204, headers=NO_STORE)
    try:
        payload = json.loads(body)
        if (not isinstance(payload, dict) or payload.get('jsonrpc') != '2.0'
                or not isinstance(payload.get('method'), str)
                or 'id' in payload and (isinstance(payload['id'], bool) or not isinstance(payload['id'], (str, int, type(None))))):
            raise ValueError()
    except (ValueError, UnicodeError):
        return JSONResponse({'error': 'INVALID_JSON_RPC'}, status_code=400, headers=NO_STORE)
    if 'id' not in payload:
        return Response(status_code=202, headers=NO_STORE)
    path = '/api/v1/mcp/project/' + managed.project_id + '/streamable'
    headers = {'x-api-key': managed.internal_api_key, 'accept': 'application/json, text/event-stream',
               'content-type': 'application/json', 'accept-encoding': 'identity'}
    try:
        async with asyncio.timeout(120):
            initial = payload if payload['method'] == 'initialize' else {
                'jsonrpc': '2.0', 'id': 'sigap-private-init', 'method': 'initialize',
                'params': {'protocolVersion': request.headers.get('mcp-protocol-version', '2025-03-26'),
                           'capabilities': {}, 'clientInfo': {'name': 'sigap-stateless-proxy', 'version': '1'}}}
            initialized, session = await exchange(client, path, headers, initial)
            if session:
                headers['mcp-session-id'] = session
            if 'result' in initialized:
                headers['mcp-protocol-version'] = initialized['result']['protocolVersion']
            try:
                if 'error' in initialized:
                    result = dict(initialized, id=payload['id'])
                elif payload['method'] == 'initialize':
                    result = initialized
                else:
                    notification = await client.post(path, headers=headers, json={
                        'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}})
                    if not notification.is_success:
                        raise RpcError('Upstream initialization rejected.')
                    result, _ = await exchange(client, path, headers, payload)
            finally:
                if session:
                    with suppress(httpx.RequestError, TimeoutError):
                        await client.delete(path, headers=headers, timeout=3)
        # Session headers and cookies are deliberately private to this one request.
        return JSONResponse(result, headers=NO_STORE)
    except (httpx.RequestError, TimeoutError, RpcError, ValueError, KeyError, TypeError):
        # A timed-out write may already have executed. Never replay tools/call.
        return JSONResponse({'error': 'MCP_UNAVAILABLE'}, status_code=502, headers=NO_STORE)
