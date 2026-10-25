import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bulletinForReading } from '../src/bulletin.ts';
import { MarkdownContent } from '../src/MarkdownContent.tsx';

test('bulletin headings, emphasis, lists and tables render as safe Markdown', () => {
  const html = renderToStaticMarkup(createElement(MarkdownContent, { text: '# Buletin donatur\n\n**DRAF**\n\n- Air bersih\n- Beras\n\n| Desa | Status |\n| --- | --- |\n| Uji | PARSIAL |\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert)' }));
  assert.match(html, /<h1>Buletin donatur<\/h1>/);
  assert.match(html, /<strong>DRAF<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<th>Status<\/th>/);
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('href="javascript:'));
});

test('only the trailing attribution is removed for display and copy', () => {
  const body = '# Buletin\n\n**DRAF — belum disetujui.**\n\nSumber: laporan posko, 21 Oktober.\n\nKonfirmasi kebutuhan kepada Pos Komando.';
  const raw = body + '\n\n_Disusun dari laporan posko; persetujuan rekap tidak membuktikan kondisi lapangan terkini. Tidak memuat data pribadi pengungsi._\n';
  assert.equal(bulletinForReading(raw), body);
  assert.ok(raw.includes('_Disusun dari laporan posko;')); // Canonical content is unchanged.
  assert.equal(bulletinForReading(body + '\n\n*Buletin ini dibuat secara otomatis oleh SIGAP.*'), body);
  assert.equal(bulletinForReading(body), body);
});

test('ordinary source notes, draft warnings and inline references remain intact', () => {
  const text = '# Buletin\n\nSumber: laporan posko.\n\nBelum disetujui untuk publikasi.';
  assert.equal(bulletinForReading(text), text);
  const quoted = 'Catatan: buletin ini dibuat oleh relawan berdasarkan data lapangan.\n\n## Kebutuhan\n- Air';
  assert.equal(bulletinForReading(quoted), quoted);
});
