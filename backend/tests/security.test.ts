import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, verifySessionToken } from '../src/security.js';
import { redact } from '../src/logging.js';

describe('Security & Origin Checks (PRD Bagian 14)', () => {
  test('Origin allowlist memeriksa asal permintaan secara ketat', () => {
    const allowed = ['http://127.0.0.1:5173', 'http://localhost:5173'];

    assert.equal(isAllowedOrigin('http://127.0.0.1:5173', allowed), true);
    assert.equal(isAllowedOrigin('http://localhost:5173/', allowed), true);
    assert.equal(isAllowedOrigin('http://malicious-site.com', allowed), false);
    assert.equal(isAllowedOrigin('http://evil.com', allowed), false);
  });

  test('Validasi Bearer token sesi lokal', () => {
    const expectedToken = 'test-token-secret-12345';

    assert.equal(verifySessionToken(`Bearer ${expectedToken}`, expectedToken), true);
    assert.equal(verifySessionToken('Bearer wrong-token', expectedToken), false);
    assert.equal(verifySessionToken('', expectedToken), false);
    assert.equal(verifySessionToken(undefined, expectedToken), false);
  });

  test('Redaksi log menghapus token, NIK, dan nomor telepon', () => {
    const logText = 'Request with Bearer mysecrettoken123 and NIK 3211012345670001 telp 081234567890';
    const redacted = redact(logText);

    assert.ok(!redacted.includes('mysecrettoken123'));
    assert.ok(!redacted.includes('3211012345670001'));
    assert.ok(!redacted.includes('081234567890'));
    assert.ok(redacted.includes('[REDACTED_TOKEN]'));
    assert.ok(redacted.includes('[NIK_REDACTED]'));
    assert.ok(redacted.includes('[PHONE_REDACTED]'));
  });
});
