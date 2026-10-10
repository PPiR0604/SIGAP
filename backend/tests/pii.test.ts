import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { filterPii } from '../src/pipeline/pii.js';

describe('PII Redaction (FR-12)', () => {
  test('menyaring NIK 16 digit dan nomor HP Indonesia', () => {
    const raw = 'Laporan dari Bpk Budi (NIK 3211012345670001, HP 081234567890). Posko Harapan butuh bantuan.';
    const res = filterPii(raw);

    assert.ok(!res.filteredText.includes('3211012345670001'));
    assert.ok(!res.filteredText.includes('081234567890'));
    assert.ok(res.filteredText.includes('[NIK]'));
    assert.ok(res.filteredText.includes('[TELEPON]'));
    assert.equal(res.piiSummary.nikCount, 1);
    assert.equal(res.piiSummary.phoneCount, 1);
    assert.equal(res.piiSummary.totalRedacted, 2);
  });

  test('menyaring email dan rekening bank kontekstual', () => {
    const raw = 'Hubungi koordinasi@posko.id atau donasi no rek: 1234567890 Bank Mandiri.';
    const res = filterPii(raw);

    assert.ok(!res.filteredText.includes('koordinasi@posko.id'));
    assert.ok(!res.filteredText.includes('1234567890'));
    assert.ok(res.filteredText.includes('[EMAIL]'));
    assert.ok(res.filteredText.includes('[REKENING]'));
    assert.equal(res.piiSummary.emailCount, 1);
    assert.equal(res.piiSummary.bankCount, 1);
  });

  test('TIDAK merusak angka non-PII penting (jumlah jiwa, jam, tanggal, rumus 45+55)', () => {
    const raw = 'Pukul 07.15 WIB tgl 02/10/2026: Posko Harapan 98 jiwa (laki 45 + perempuan 55 = 100 ≠ 98). Butuh 1500 liter air.';
    const res = filterPii(raw);

    assert.equal(res.piiSummary.totalRedacted, 0);
    assert.ok(res.filteredText.includes('07.15'));
    assert.ok(res.filteredText.includes('02/10/2026'));
    assert.ok(res.filteredText.includes('98 jiwa'));
    assert.ok(res.filteredText.includes('45 + perempuan 55 = 100 ≠ 98'));
    assert.ok(res.filteredText.includes('1500 liter air'));
  });
});
