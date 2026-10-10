import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { SigapRepository } from '../src/db/repo.js';
import { FakeAgentRuntime } from '../src/acp/fakeRuntime.js';
import type { FastifyInstance } from 'fastify';

describe('SIGAP Backend API Integration Tests', () => {
  let app: FastifyInstance;
  let repo: SigapRepository;
  let token: string;

  before(async () => {
    repo = new SigapRepository(':memory:');
    const fakeRuntime = new FakeAgentRuntime();
    const serverBundle = await buildServer({
      repo,
      runtime: fakeRuntime,
      config: {
        host: '127.0.0.1',
        port: 8787,
        allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
        bobCommand: 'bob',
        bobArgs: '',
        bobWorkspace: 'output/bob-workspace',
        langflowUrl: 'http://localhost:7860',
        snapshotDir: 'output/.sigap_snapshots',
        maxInputBytes: 204800,
        retentionDays: 7,
        approvalTtlSeconds: 3600,
        dbPath: ':memory:',
        sessionToken: 'test-secret-token-xyz'
      }
    });

    app = serverBundle.app;
    token = serverBundle.config.sessionToken;
    await app.ready();
  });

  after(async () => {
    await app.close();
    repo.close();
  });

  test('GET /api/health dapat diakses tanpa token autentikasi', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.status, 'ok');
    assert.equal(body.backend, 'ready');
    assert.equal(body.write_enabled, false);
    assert.equal(body.mode, 'mock_mode');
    assert.equal(body.session_token, token);
  });

  test('GET /api/auth/token mengembalikan token sesi lokal tanpa auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/token'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.token, token);
  });

  test('Endpoint /api/sessions menolak akses tanpa token (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {}
    });

    assert.equal(res.statusCode, 401);
  });

  test('Endpoint menolak request dari Origin yang tidak diizinkan (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: {
        origin: 'http://evil-attacker.com',
        authorization: `Bearer ${token}`
      },
      payload: {}
    });

    assert.equal(res.statusCode, 403);
  });

  test('POST /api/sessions membuat sesi baru dengan token valid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'http://127.0.0.1:5173'
      },
      payload: { context_id: 'posko-sumedang' }
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.ok(body.session_id);
    assert.equal(body.context_id, 'posko-sumedang');
  });

  test('POST /api/sessions/:id/messages memproses laporan dan menyaring PII', async () => {
    // 1. Create session
    const sessRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { context_id: 'posko-sumedang' }
    });
    const sessionId = JSON.parse(sessRes.payload).session_id;

    // 2. Send message
    const msgRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        request_id: 'req-msg-1',
        text: 'Posko Harapan: 98 jiwa. Kontak Bpk Rudi (NIK 3211012345670001, HP 081234567890). Butuh beras dan air.'
      }
    });

    assert.equal(msgRes.statusCode, 202);
    const body = JSON.parse(msgRes.payload);
    assert.ok(body.batch_id);
    assert.equal(body.status, 'processing');
    assert.ok(body.filtered_text.includes('[NIK]'));
    assert.ok(body.filtered_text.includes('[TELEPON]'));
    assert.equal(body.pii_summary.nikCount, 1);
    assert.equal(body.pii_summary.phoneCount, 1);

    // 3. Test idempotency: sending same request_id returns existing batch
    const idempotentRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        request_id: 'req-msg-1',
        text: 'different text'
      }
    });
    assert.equal(idempotentRes.statusCode, 200);
    const idemBody = JSON.parse(idempotentRes.payload);
    assert.equal(idemBody.batch_id, body.batch_id);
  });

  test('GET /api/batches/:id mengambil status dan data kanonis untuk pemulihan', async () => {
    const sessRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    const sessionId = JSON.parse(sessRes.payload).session_id;

    const msgRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        request_id: 'req-recovery-1',
        text: 'Posko Cibening: 91 jiwa'
      }
    });
    const batchId = JSON.parse(msgRes.payload).batch_id;

    // Wait a brief moment for async orchestrator event to settle
    await new Promise((r) => setTimeout(r, 100));

    const batchRes = await app.inject({
      method: 'GET',
      url: `/api/batches/${batchId}`,
      headers: { authorization: `Bearer ${token}` }
    });

    assert.equal(batchRes.statusCode, 200);
    const batch = JSON.parse(batchRes.payload);
    assert.equal(batch.batch_id, batchId);
    assert.ok(batch.status);
  });

  test('GET /api/sessions/:id/events mendukung SSE replay dengan Last-Event-ID', async () => {
    const sessRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    const sessionId = JSON.parse(sessRes.payload).session_id;

    // Add dummy event to DB
    repo.appendEvent({
      sessionId,
      eventType: 'assistant_message',
      payload: { text: 'Halo petugas' }
    });

    const sseRes = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/events?stream=false`,
      headers: {
        authorization: `Bearer ${token}`,
        'last-event-id': '0'
      }
    });

    assert.equal(sseRes.statusCode, 200);
    assert.ok(sseRes.headers['content-type']?.includes('text/event-stream'));
    assert.ok(sseRes.payload.includes('event: assistant_message'));
    assert.ok(sseRes.payload.includes('Halo petugas'));
  });

  test('Isolasi Sesi: dua sesi tidak saling melihat event atau salah terima notifikasi', async () => {
    const s1 = repo.createSession('posko-1');
    const s2 = repo.createSession('posko-2');

    repo.appendEvent({
      sessionId: s1.session_id,
      eventType: 'assistant_message',
      payload: { text: 'Pesan Khusus Posko 1' }
    });

    const sse2 = await app.inject({
      method: 'GET',
      url: `/api/sessions/${s2.session_id}/events?stream=false`,
      headers: { authorization: `Bearer ${token}` }
    });

    // Session 2 MUST NOT see Session 1's events
    assert.ok(!sse2.payload.includes('Pesan Khusus Posko 1'));
  });
});
