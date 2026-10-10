import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePrepareNeedsOutput,
  parseSigapReference,
  parseSigapWriteResult,
  parseSigapReadResult,
  parseGapResult,
  parseBulletinResult
} from '../src/pipeline/toolResults.js';

describe('Tool Results Parsing (FR-03, FR-04)', () => {
  const validSnapshotId = '1234567890abcdef1234567890abcdef';
  const validSha256 = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

  test('membedakan angka nol (0) dan null (belum diketahui)', () => {
    const raw = `SIGAP_REFERENCE {"snapshot_id":"${validSnapshotId}","snapshot_sha256":"${validSha256}"}
\`\`\`json
{
  "snapshot_id": "${validSnapshotId}",
  "snapshot_sha256": "${validSha256}",
  "records": [
    {
      "report_id": "R01",
      "shelter_name": "Posko A",
      "total_people": 50,
      "disability": 0,
      "elderly": null
    }
  ],
  "snapshot_records": [
    {
      "report_id": "R01",
      "shelter_name": "Posko A",
      "total_people": 50,
      "disability": 0,
      "elderly": null
    }
  ],
  "issues": [],
  "snapshot_issues": []
}
\`\`\``;

    const parsed = parsePrepareNeedsOutput(raw);
    assert.equal(parsed.records[0].disability, 0);
    assert.equal(parsed.records[0].elderly, null);
    assert.notEqual(parsed.records[0].disability, parsed.records[0].elderly);
  });

  test('menolak snapshot_id atau sha256 yang formatnya tidak valid', () => {
    const invalidRaw = `SIGAP_REFERENCE {"snapshot_id":"invalid_id","snapshot_sha256":"short_hash"}
\`\`\`json
{
  "snapshot_id": "invalid_id",
  "snapshot_sha256": "short_hash",
  "records": []
}
\`\`\``;

    assert.throws(() => {
      parsePrepareNeedsOutput(invalidRaw);
    });
  });

  test('mem-parse SIGAP_WRITE_RESULT dengan tepat', () => {
    const raw = `SIGAP_WRITE_RESULT {"snapshot_id":"${validSnapshotId}","snapshot_sha256":"${validSha256}","storage":{"mode":"csv","path":"output/rekap.csv"}}
BERHASIL [mode: CSV] — 2 baris diperbarui ke output/rekap.csv`;

    const res = parseSigapWriteResult(raw);
    assert.equal(res.snapshot_id, validSnapshotId);
    assert.equal(res.storage?.mode, 'csv');
  });

  test('mem-parse SIGAP_READ_RESULT dan status verifikasi', () => {
    const raw = `SIGAP_READ_RESULT {"status":"ok","verification_status":"verified","total_shelters":6,"matched_shelters":6,"snapshot_id":"${validSnapshotId}","snapshot_sha256":"${validSha256}"}
\`\`\`json
{
  "status": "ok",
  "source": "Penyimpanan Lokal",
  "total_shelters": 6,
  "matched_shelters": 6,
  "verification": {
    "status": "verified",
    "matched_count": 6
  }
}
\`\`\``;

    const res = parseSigapReadResult(raw);
    assert.equal(res.status, 'ok');
    assert.equal(res.verification_status, 'verified');
    assert.equal(res.verification?.status, 'verified');
    assert.equal(res.verification?.matched_count, 6);
  });

  test('mem-parse hasil kalkulasi gap', () => {
    const raw = `\`\`\`json
{
  "shelters": [
    {
      "shelter_name": "Posko Harapan",
      "priority": "TINGGI",
      "reasons": ["air bersih kritis"],
      "issues": [],
      "gaps": { "air_liter_per_hari": 970 },
      "needs": { "air_liter_per_hari": 1470 }
    }
  ],
  "totals": {
    "total_people": 98,
    "air_liter_per_hari": 1470
  }
}
\`\`\``;

    const res = parseGapResult(raw);
    assert.equal(res.shelters.length, 1);
    assert.equal(res.shelters[0].priority, 'TINGGI');
    assert.equal(res.totals.air_liter_per_hari, 1470);
  });

  test('mem-parse draf buletin', () => {
    const raw = `\`\`\`json
{
  "action": "create_doc",
  "content": "BULETIN POSKO DRAF",
  "content_sha256": "${validSha256}",
  "preview_at": "2026-10-08T00:00:00"
}
\`\`\``;

    const res = parseBulletinResult(raw);
    assert.equal(res.content, 'BULETIN POSKO DRAF');
    assert.equal(res.content_sha256, validSha256);
  });

  const bulletinPreview = {
    action: 'create_doc',
    content: '**DRAF — BELUM DIVERIFIKASI.**\n\n# Kebutuhan\n- Air bersih',
    content_sha256: validSha256,
    preview_at: '2026-10-08T10:00:00',
    confirmed_create_doc: false,
    approved_content_sha256: null
  };

  test('menerima hash persetujuan null pada pratinjau yang belum disetujui', () => {
    assert.deepEqual(parseBulletinResult(JSON.stringify(bulletinPreview)), bulletinPreview);
  });

  test('membaca JSON pratinjau setelah penolakan aksi Google Docs oleh Langflow', () => {
    for (const newline of ['\n', '\r\n']) {
      const raw = ['DITOLAK — tidak ada aksi eksternal: Pembuatan Google Docs belum disetujui untuk isi pratinjau ini.',
        '', 'Pratinjau (belum disimpan):', JSON.stringify(bulletinPreview, null, 2)].join(newline);
      assert.deepEqual(parseBulletinResult(raw), bulletinPreview);
    }
  });

  test('membaca pratinjau ketika MCP mengirim salinan formatted dan raw sekaligus', () => {
    const prefix = 'DITOLAK — tidak ada aksi eksternal.\n\nPratinjau (belum disimpan):\n';
    const raw = prefix + JSON.stringify(bulletinPreview, null, 2).replace(/\n/g, '\n\n') + '\n'
      + prefix + JSON.stringify(bulletinPreview, null, 2);
    assert.deepEqual(parseBulletinResult(raw), bulletinPreview);
  });

  test('tetap menolak output gagal atau pratinjau tanpa kontrak lengkap', () => {
    for (const raw of [
      'GAGAL: Snapshot tidak ditemukan.',
      'DITOLAK — tidak ada aksi eksternal.',
      'Pratinjau (belum disimpan):\n{broken}',
      'Pratinjau (belum disimpan):\n' + JSON.stringify({ content: 'DRAF' }),
      'Pratinjau (belum disimpan):\n' + JSON.stringify({ ...bulletinPreview, content_sha256: 'invalid' }),
      'Pratinjau (belum disimpan):\n' + JSON.stringify({ ...bulletinPreview, preview_at: null })
    ]) assert.throws(() => parseBulletinResult(raw));
  });
});
