import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bulletinForReading,bulletinTable } from '../src/bulletin.ts';
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

test('reported quantities use only matching source items, preserve zero and keep different units separate',()=>{
 const input='## Kebutuhan\n\n- Beras (diminta 3 posko)\n- Selimut (diminta 1 posko)\n- Obat (diminta 1 posko)\n\nCatatan.';
 const records=[{urgent_needs:[{item:'beras',qty:10,unit:'kg'},{item:'selimut',qty:0,unit:'lembar'}]},{urgent_needs:[{item:'Beras',qty:4,unit:'kg'}]},{urgent_needs:[{item:'beras',qty:2,unit:'karung'}]}];
 const rendered=bulletinTable(input,records);
 assert.match(rendered,/14 kg \(2 posko memiliki jumlah\); 2 karung \(1 posko memiliki jumlah\)/);
 assert.match(rendered,/Selimut \| 1 posko \| 0 lembar/);
 assert.match(rendered,/Obat \| 1 posko \| Belum dilaporkan/);
 assert.match(rendered,/Catatan\./);
 const duplicate=bulletinTable('- Beras (diminta 1 posko)',[{urgent_needs:[{item:'beras',qty:10,unit:'kg'},{item:'beras',qty:10,unit:'kg'}]}]);
 assert.match(duplicate,/Belum dilaporkan/);
});

test('village summaries become a table without dropping flags, times or unrelated lists',()=>{
 const input='## Ringkasan per desa\n\n- **Kemiri** — 100 jiwa. Dibutuhkan: Air, Beras. Waktu sumber: 02-10-2026 07:15; 29-10-2026 01:33 WIB. Catatan: perlu klarifikasi data; sumber lebih dari 24 jam.\n- **Lokasi belum disebut** — jumlah jiwa belum dilaporkan. Dibutuhkan: (kebutuhan spesifik belum dicatat). Waktu sumber: belum diketahui WIB.\n\n## Cara menyalurkan\n- Hubungi posko';
 const output=bulletinTable(input);assert.match(output,/\| Desa \| Jiwa \| Kebutuhan \| Waktu sumber \| Catatan \|/);assert.match(output,/Kemiri \| 100 jiwa \| Air, Beras \| 02-10-2026 07:15; 29-10-2026 01:33 WIB \| perlu klarifikasi data/);assert.match(output,/jumlah jiwa belum dilaporkan/);assert.match(output,/- Hubungi posko/);
 const unknown='## Ringkasan per desa\n- format lain yang belum dikenal\n\n## Lain\nTeks';assert.equal(bulletinTable(unknown),unknown);
});
