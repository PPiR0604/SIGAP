// UI-only regression: all backend responses are synthetic; no agent calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(path.join(process.env.SIGAP_BROWSER_PACKAGES || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.SIGAP_BROWSER_EXECUTABLE ? { executablePath: process.env.SIGAP_BROWSER_EXECUTABLE } : {}) });
const text = '**Pratinjau Kanonis (R001)**\n- **Status:** Parsial / Belum Lengkap\n- **Posko / Desa:** Belum diketahui (?)\n- **Jumlah Jiwa:** Belum diketahui (?)\n- **Kebutuhan Mendesak:** Belum ada data\n\n**Informasi yang Perlu Ditanyakan ke Petugas:**\nLaporan yang diterima tidak menyertakan rincian kondisi posko. Mohon lengkapi data berikut:\n1. Nama Posko dan Desa/Kelurahan\n2. Jumlah pengungsi terpilah (Total jiwa, Laki-laki, Perempuan, Bayi/Balita, Lansia, Ibu Hamil, Ibu Menyusui, Penyandang Disabilitas)\n3. Kebutuhan mendesak (air bersih, makanan, obat-obatan, dll.)\n\nData ini belum tersimpan ke dalam sistem rekap.';
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/events')) {
      await route.fulfill({ contentType: 'text/event-stream', body: `id: 1\nevent: assistant_message\ndata: ${JSON.stringify({ chunk: text })}\n\n` });
    } else {
      await route.fulfill({ json: url.endsWith('/health') ? { status: 'ok', agent: 'mock', backend: 'ready', bob: 'unavailable', storage: 'local', write_enabled: false, mode: 'mock_mode' } : { session_id: 'markdown-test', context_id: 'synthetic', created_at: new Date().toISOString() } });
    }
  });
  await page.goto(process.env.SIGAP_BROWSER_TEST_URL || 'http://127.0.0.1:5173');
  const markdown = page.locator('.chat-message.assistant .chat-markdown');
  await markdown.waitFor();
  assert.equal(await markdown.locator('ul > li').count(), 4);
  assert.equal(await markdown.locator('ol > li').count(), 3);
  assert.equal(await markdown.locator('strong').first().textContent(), 'Pratinjau Kanonis (R001)');
  assert.equal(await markdown.locator('p').first().evaluate(el => getComputedStyle(el).whiteSpace), 'normal');
  await mkdir('../output', { recursive: true });
  await page.locator('.chat-history').screenshot({ path: '../output/chat-markdown-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page must not overflow horizontally');
  await page.locator('.chat-history').screenshot({ path: '../output/chat-markdown-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: actual chat renders bold, bullet and numbered lists; desktop/mobile layout has no overflow or JS errors.');
} finally {
  await browser.close();
}
