import os
import math
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

TOOLS = ('fetch_shelters', 'prepare_needs', 'validate_needs', 'calculate_gap',
         'flag_anomalies', 'upsert_shelter', 'draft_bulletin')


def backend_url(value, local=False):
    parsed = urlsplit(value)
    is_local = parsed.hostname in ('localhost', '127.0.0.1', '::1', 'host.docker.internal')
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ('', '/') or parsed.scheme != 'https' and not (local and is_local and parsed.scheme == 'http')):
        raise ValueError('SIGAP_BACKEND_INTERNAL_URL must be an HTTPS origin reachable from MCP.')
    if is_local and not local:
        raise ValueError('The deployed MCP cannot call a laptop localhost URL.')
    return value.rstrip('/')


@dataclass(frozen=True)
class Settings:
    api_key: str
    superuser: str
    password: str
    secret_key: str
    backend: str
    port: int = 10000
    internal_port: int = 7860
    timeout: float = 600
    data_dir: Path = Path(tempfile.gettempdir()) / 'sigap-mcp'
    flows_dir: Path = Path(__file__).resolve().parents[1] / 'flows' / 'supabase'
    allowed_origins: tuple = ()
    stateless: bool = False

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        vercel = env.get('VERCEL') == '1' or env.get('SIGAP_DEPLOY_TARGET') == 'vercel'
        def required(name, minimum):
            value = env.get(name, '').strip()
            if len(value) < minimum or any(s in value.lower() for s in ('replace_', 'your_', 'change_me')):
                raise ValueError(f'{name} must be set to a non-placeholder secret of at least {minimum} characters.')
            return value
        api_key = required('LANGFLOW_API_KEY', 32)
        password = required('LANGFLOW_SUPERUSER_PASSWORD', 16)
        secret_key = required('LANGFLOW_SECRET_KEY', 32)
        if len({api_key, password, secret_key}) != 3:
            raise ValueError('Use independent secrets for API key, password and signing key.')
        port, internal = int(env.get('PORT', '10000')), int(env.get('SIGAP_LANGFLOW_INTERNAL_PORT', '7860'))
        if not (1 <= port <= 65535 and 1 <= internal <= 65535) or port == internal:
            raise ValueError('Public and internal ports must be valid and different.')
        timeout = float(env.get('SIGAP_MCP_STARTUP_TIMEOUT_SECONDS', '150' if vercel else '600'))
        maximum = 150 if vercel else 1800
        if not math.isfinite(timeout) or not 30 <= timeout <= maximum:
            raise ValueError(f'Startup timeout must be between 30 and {maximum} seconds.')
        superuser = env.get('LANGFLOW_SUPERUSER', 'sigap-mcp').strip()
        if not superuser:
            raise ValueError('LANGFLOW_SUPERUSER cannot be empty.')
        origins = tuple(s.strip().rstrip('/') for s in env.get('SIGAP_MCP_ALLOWED_ORIGINS', '').split(',') if s.strip())
        for origin in origins:
            if backend_url(origin, local=False) != origin:
                raise ValueError('Allowed browser origins must be exact HTTPS origins.')
        return cls(api_key=api_key, superuser=superuser,
                   password=password, secret_key=secret_key,
                   backend=backend_url(env.get('SIGAP_BACKEND_INTERNAL_URL', ''), env.get('SIGAP_MCP_ALLOW_LOCAL_BACKEND') == '1' and env.get('RENDER') != 'true' and not vercel),
                   port=port, internal_port=internal,
                   timeout=timeout,
                   data_dir=Path(env.get('SIGAP_MCP_DATA_DIR', str(Path(tempfile.gettempdir()) / 'sigap-mcp'))),
                   flows_dir=Path(env.get('SIGAP_MCP_FLOWS_DIR', str(Path(__file__).resolve().parents[1] / 'flows' / 'supabase'))),
                   allowed_origins=origins, stateless=vercel or env.get('SIGAP_MCP_STATELESS') == '1')

    @property
    def upstream(self):
        return f'http://127.0.0.1:{self.internal_port}'
