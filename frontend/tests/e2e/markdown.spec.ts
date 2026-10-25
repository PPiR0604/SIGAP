import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const table = '| Report | Posko | Desa | Jiwa | Kebutuhan terbaru | Status |\n| --- | --- | --- | ---: | --- | --- |\n| R001 | Posko Harapan | Sukamaju | 98 | Air bersih | PERLU_KLARIFIKASI |';
const bulletinBody = '# Buletin kebutuhan donatur\n\n**DRAF — belum disetujui.**\n\n## Kebutuhan utama\n- **Air bersih** untuk Sukamaju\n- Beras\n\n' + table + '\n\nSumber: laporan posko, 21 Oktober 2026.\n\nKonfirmasi kebutuhan kepada Pos Komando.';
const footer = '_Disusun dari laporan posko; persetujuan rekap tidak membuktikan kondisi lapangan terkini. Tidak memuat data pribadi pengungsi._';

async function openMarkdown(page: Page) {
  // Controlled SSE content exercises the real React renderer without model variability.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/sessions/*/events', route => route.fulfill({
    contentType: 'text/event-stream',
    body: `id: 1\nevent: assistant_message\ndata: ${JSON.stringify({ text: 'Pratinjau kandidat saat ini:\n\n' + table })}\n\nid: 2\nevent: bulletin_ready\ndata: ${JSON.stringify({ content: bulletinBody + '\n\n' + footer })}\n\n`,
  }));
  await page.goto('/');
  await expect(page.getByRole('log')).toContainText('Pratinjau kandidat saat ini:');
}

test('tabel chat tetap ringkas dan kolom terakhir tersedia pada desktop/mobile', async ({ page }, testInfo) => {
  await openMarkdown(page);
  const scroller = page.getByRole('region', { name: 'Tabel jawaban Agent' });
  const status = scroller.getByRole('cell', { name: 'PERLU_KLARIFIKASI', exact: true });
  await expect(status).toBeVisible();
  await expect(scroller.getByRole('columnheader', { name: 'Status', exact: true })).toBeVisible();
  expect(await scroller.getByRole('columnheader').count()).toBe(6);
  const bounds = await status.boundingBox();
  expect(bounds!.height, 'A short status must not wrap into a tall column').toBeLessThan(65);
  expect(bounds!.width).toBeGreaterThan(120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const container = await scroller.boundingBox();
  const last = await status.boundingBox();
  expect(last!.x).toBeGreaterThanOrEqual(container!.x - 1);
  expect(last!.x + last!.width).toBeLessThanOrEqual(container!.x + container!.width + 1);
  await page.screenshot({ path: testInfo.outputPath('chat-markdown-table.png'), fullPage: true });
});

test('buletin menampilkan Markdown, menghapus penutup, dan menyalin draf yang sama', async ({ page, context }, testInfo) => {
  await openMarkdown(page);
  await page.getByRole('button', { name: 'Buletin', exact: true }).click();
  const paper = page.getByRole('article', { name: 'Isi draf buletin' });
  await expect(paper.getByRole('heading', { name: 'Buletin kebutuhan donatur', exact: true })).toBeVisible();
  await expect(paper.getByRole('heading', { name: 'Kebutuhan utama', exact: true })).toBeVisible();
  await expect(paper.getByRole('listitem')).toHaveCount(2);
  await expect(paper.locator('strong').filter({ hasText: 'Air bersih' })).toBeVisible();
  await expect(paper.getByRole('columnheader', { name: 'Status', exact: true })).toBeVisible();
  await expect(paper).not.toContainText('Disusun dari laporan posko;');
  await expect(paper).toContainText('Sumber: laporan posko, 21 Oktober 2026.');
  await expect(paper).toContainText('DRAF — belum disetujui.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Salin draf' }).click();
  // Windows clipboard normalizes line endings to CRLF.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(bulletinBody);
  await page.screenshot({ path: testInfo.outputPath('buletin-markdown.png'), fullPage: true });
});
