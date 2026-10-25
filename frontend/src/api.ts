export interface HealthResponse {
  agent?: 'gemini' | 'openai' | 'bob' | 'mock';
  model?:string;
  provider_status?: 'configured' | 'unavailable' | 'simulated';
  status: string;
  backend: string;
  bob: string;
  storage: string;
  write_enabled: boolean;
  mode: 'live' | 'mock_mode' | 'degraded';
  session_token?: string;
}

export interface SessionResponse {
  session_id: string;
  context_id: string;
  created_at: string;
}

export interface MessageResponse {
  batch_id: string;
  status: string;
  filtered_text: string;
  pii_summary: {
    nikCount: number;
    phoneCount: number;
    emailCount: number;
    bankCount: number;
    totalRedacted: number;
  };
}

export interface BatchStateResponse {
  batch_id: string;
  session_id: string;
  context_id: string;
  status: string;
  latest_snapshot_id: string | null;
  latest_snapshot_sha256: string | null;
  quality_status: string | null;
  preview: any;
  gap: any;
  bulletin: any;
  created_at: string;
  updated_at: string;
}

let activeSessionToken = '';

export function getSessionToken(): string {
  try {
    return activeSessionToken || localStorage.getItem('sigap_token') || (import.meta as any).env?.VITE_SIGAP_TOKEN || '';
  } catch {
    return activeSessionToken || '';
  }
}

export function setSessionToken(token: string): void {
  activeSessionToken = token;
  try {
    localStorage.setItem('sigap_token', token);
  } catch {
    // ignore
  }
}

export async function fetchSessionToken(): Promise<string> {
  try {
    const res = await fetch('/api/auth/token');
    if (res.ok) {
      const data = await res.json();
      if (data?.token) {
        setSessionToken(data.token);
        return data.token;
      }
    }
  } catch {
    // ignore
  }
  return getSessionToken();
}

export async function checkBackendHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    const data: HealthResponse = await res.json();
    if (data.session_token) {
      setSessionToken(data.session_token);
    }
    return data;
  } catch {
    return null;
  }
}

export async function ensureSessionToken(): Promise<string> {
  let token = getSessionToken();
  if (token) return token;
  const health = await checkBackendHealth();
  if (health?.session_token) return health.session_token;
  return await fetchSessionToken();
}

export async function createBackendSession(contextId = 'posko-sumedang'): Promise<SessionResponse> {
  let token = await ensureSessionToken();
  let res = await fetch('/api/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ context_id: contextId })
  });

  if (res.status === 401) {
    const freshHealth = await checkBackendHealth();
    if (freshHealth?.session_token && freshHealth.session_token !== token) {
      token = freshHealth.session_token;
      res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ context_id: contextId })
      });
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gagal membuat sesi (${res.status}).`);
  }
  return await res.json();
}

export async function sendBackendMessage(
  sessionId: string,
  text: string,
  filename?: string
): Promise<MessageResponse> {
  let token = await ensureSessionToken();
  const requestId = 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  let res = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      request_id: requestId,
      text,
      filename
    })
  });

  if (res.status === 401) {
    const freshHealth = await checkBackendHealth();
    if (freshHealth?.session_token && freshHealth.session_token !== token) {
      token = freshHealth.session_token;
      res = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          request_id: requestId,
          text,
          filename
        })
      });
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gagal mengirim pesan (${res.status}).`);
  }
  return await res.json();
}

export async function getBatchState(batchId: string): Promise<BatchStateResponse> {
  let token = await ensureSessionToken();
  let res = await fetch(`/api/batches/${batchId}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  if (res.status === 401) {
    const freshHealth = await checkBackendHealth();
    if (freshHealth?.session_token && freshHealth.session_token !== token) {
      token = freshHealth.session_token;
      res = await fetch(`/api/batches/${batchId}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gagal mengambil status batch (${res.status}).`);
  }
  return await res.json();
}

export async function submitBatchDecision(
  batchId: string,
  decision: {
    action: 'approve_save' | 'approve_partial_save' | 'back_to_review';
    snapshot_id: string;
    partial_acknowledged: boolean;
    clear_decisions: Record<string, Record<string, 'clear' | 'keep' | 'defer'>>;
    conflict_decisions?: Record<string,Record<string,'keep'|'incoming'>>;
  }
): Promise<{ success: boolean; status: string }> {
  let token = await ensureSessionToken();
  let res = await fetch(`/api/batches/${batchId}/decisions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(decision)
  });

  if (res.status === 401) {
    const freshHealth = await checkBackendHealth();
    if (freshHealth?.session_token && freshHealth.session_token !== token) {
      token = freshHealth.session_token;
      res = await fetch(`/api/batches/${batchId}/decisions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(decision)
      });
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Keputusan ditolak (${res.status}).`);
  }
  return await res.json();
}
