import asyncio
import hmac
import logging
from contextlib import asynccontextmanager, suppress
from http.cookiejar import CookieJar, DefaultCookiePolicy

import httpx
from fastapi import FastAPI, Request
from starlette.background import BackgroundTask
from starlette.responses import JSONResponse, StreamingResponse

from .config import Settings
from .runtime import ManagedLangflow
from .stateless import invoke_stateless

MAX_BODY = 1024 * 1024
REQUEST_HEADERS = ('accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id')
RESPONSE_HEADERS = ('content-type', 'mcp-session-id', 'mcp-protocol-version', 'cache-control')


class NoCookies(DefaultCookiePolicy):
    def set_ok(self, *args, **kwargs):
        return False

    def return_ok(self, *args, **kwargs):
        return False


def create_app(settings=None, runtime=None, transport=None):
    settings = settings or Settings.from_env()
    managed = runtime or ManagedLangflow(settings)

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(managed.start())
        # Do not print exceptions containing upstream response bodies, source text or credentials.
        def completed(result):
            if not result.cancelled() and result.exception():
                logging.getLogger('sigap.mcp').error('MCP bootstrap failed during %s (%s); readiness remains unavailable.',
                    getattr(managed, 'phase', 'starting'), getattr(managed, 'failure_detail', type(result.exception()).__name__))
        task.add_done_callback(completed)
        app.state.startup_task = task
        app.state.client = httpx.AsyncClient(base_url=settings.upstream, timeout=httpx.Timeout(300, connect=10),
                                             follow_redirects=False, trust_env=False, transport=transport,
                                             cookies=CookieJar(policy=NoCookies()))
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
            await managed.stop()
            await app.state.client.aclose()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.runtime = managed

    async def wait_ready():
        if settings.stateless:
            # Cold-start work runs while an HTTP request is active on Fluid compute.
            deadline = asyncio.get_running_loop().time() + settings.timeout + 5
            while not managed.ready and not managed.failure and not app.state.startup_task.done():
                if asyncio.get_running_loop().time() >= deadline:
                    break
                await asyncio.sleep(0.1)
        return managed.ready and not managed.failure

    @app.get('/health')
    async def health():
        ready = await wait_ready()
        return JSONResponse({'status': 'ok' if ready else 'starting', 'service': 'sigap-mcp'}, status_code=200 if ready else 503, headers={'cache-control': 'no-store'})

    async def mcp(request: Request):
        supplied = request.headers.get('x-api-key', '')
        if not hmac.compare_digest(supplied.encode(), settings.api_key.encode()):
            return JSONResponse({'error': 'UNAUTHORIZED'}, status_code=401)
        origin = request.headers.get('origin')
        if origin and origin.rstrip('/') not in settings.allowed_origins:
            return JSONResponse({'error': 'ORIGIN_DENIED'}, status_code=403)
        if request.url.query:
            return JSONResponse({'error': 'QUERY_NOT_ALLOWED'}, status_code=400)
        if not await wait_ready():
            return JSONResponse({'error': 'MCP_NOT_READY'}, status_code=503)
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BODY:
                return JSONResponse({'error': 'BODY_TOO_LARGE'}, status_code=413)
            chunks.append(chunk)
        if settings.stateless:
            return await invoke_stateless(request, b''.join(chunks), managed, request.app.state.client)
        headers = {key: request.headers[key] for key in REQUEST_HEADERS if key in request.headers}
        headers['x-api-key'] = managed.internal_api_key
        headers['accept-encoding'] = 'identity'
        path = '/api/v1/mcp/project/' + managed.project_id + '/streamable'
        client = request.app.state.client
        try:
            upstream = await client.send(client.build_request(request.method, path, headers=headers, content=b''.join(chunks)), stream=True)
        except httpx.RequestError:
            return JSONResponse({'error': 'MCP_UNAVAILABLE'}, status_code=502)
        if upstream.is_redirect:
            await upstream.aclose()
            return JSONResponse({'error': 'UPSTREAM_REDIRECT_DENIED'}, status_code=502)
        # Never forward upstream cookies, admin access tokens, proxy headers or redirect locations.
        forwarded = {key: upstream.headers[key] for key in RESPONSE_HEADERS if key in upstream.headers}
        forwarded.setdefault('cache-control', 'no-store')
        return StreamingResponse(upstream.aiter_bytes(), status_code=upstream.status_code, headers=forwarded,
                                 background=BackgroundTask(upstream.aclose))

    app.add_api_route('/mcp', mcp, methods=['GET', 'POST', 'DELETE'])
    app.add_api_route('/mcp/', mcp, methods=['GET', 'POST', 'DELETE'], include_in_schema=False)
    return app
