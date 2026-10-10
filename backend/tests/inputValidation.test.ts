import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateReportInput } from '../src/pipeline/inputValidation.js';

describe('Input Validation (FR-01)', () => {
  test('menolak teks kosong atau hanya spasi', () => {
    const res1 = validateReportInput('');
    assert.equal(res1.valid, false);
    assert.equal(res1.error?.code, 'EMPTY_INPUT');

    const res2 = validateReportInput('   \n  \t  ');
    assert.equal(res2.valid, false);
    assert.equal(res2.error?.code, 'EMPTY_INPUT');
  });

  test('menolak file selain .txt', () => {
    const resPdf = validateReportInput('Posko Harapan 98 jiwa', 'laporan.pdf');
    assert.equal(resPdf.valid, false);
    assert.equal(resPdf.error?.code, 'INVALID_FILE_TYPE');

    const resDocx = validateReportInput('Posko Harapan 98 jiwa', 'laporan.docx');
    assert.equal(resDocx.valid, false);
    assert.equal(resDocx.error?.code, 'INVALID_FILE_TYPE');
  });

  test('menerima file dengan ekstensi .txt', () => {
    const res = validateReportInput('Posko Harapan 98 jiwa', 'chat_wa.txt');
    assert.equal(res.valid, true);
  });

  test('menolak input yang melebihi batas byte maksimum (200 KiB)', () => {
    const maxBytes = 1000;
    const hugeText = 'A'.repeat(1005);
    const res = validateReportInput(hugeText, undefined, maxBytes);
    assert.equal(res.valid, false);
    assert.equal(res.error?.code, 'EXCEEDS_MAX_SIZE');
    assert.ok(res.error?.message.includes('melebihi batas'));
  });

  test('menghitung byte UTF-8 multibyte dengan tepat', () => {
    // Emoji 4 bytes
    const text = '😀';
    const res = validateReportInput(text, undefined, 10);
    assert.equal(res.valid, true);
    assert.equal(res.byteLength, 4);
  });
});
