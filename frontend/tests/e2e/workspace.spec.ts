import { readFile } from 'node:fs/promises';
import { test, expect, composer, sendButton, recapRows, createPreview } from './fixtures';

test('bootstrap token otomatis, navigasi, dan kandidat awal kosong', async ({ app }) => {
  await expect(sendButton(app)).toBeDisabled();
  expect(await app.evaluate(() => localStorage.getItem('sigap_token'))).toBe('sigap-playwright-local-only');
  await app.getByRole('button', { name: 'Rekap', exact: true }).click();
  await expect(app.getByRole('heading', { name: 'Rekap posko', exact: true })).toBeFocused();
  await expect(recapRows(app)).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Tinjau & setujui' })).toBeDisabled();
  await app.getByRole('button', { name: 'Buletin', exact: true }).click();
  await expect(app.getByText('Draf buletin belum ada', { exact: true })).toBeVisible();
  await expect(app.getByText('Publikasi oleh admin',{exact:true})).toBeVisible();await expect(app.getByRole('button',{name:'Tinjau publikasi',exact:true})).toHaveCount(0);
  await app.getByRole('link', { name: 'SIGAP, halaman laporan' }).click();
  await expect(composer(app)).toBeVisible();
});

test('laporan menghasilkan kandidat mock dan detail konflik yang bisa diklarifikasi', async ({ app }) => {
  await createPreview(app);
  await app.getByRole('button', { name: 'Posko Harapan', exact: true }).click();
  const dialog = app.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});
  await expect(dialog).toContainText('98');
  await expect(dialog).toContainText('45');
  await expect(dialog).toContainText('55');
  await dialog.getByRole('button',{name:'Sumber laporan',exact:true}).click();await expect(app.getByRole('tooltip')).toContainText('Rujuk bukti sumber pada hasil validasi server.');await dialog.getByRole('button',{name:'Sumber laporan',exact:true}).press('Escape');
  if(await dialog.getByRole('button', { name: 'Tulis klarifikasi' }).count())await dialog.getByRole('button', { name: 'Tulis klarifikasi' }).click();
  await expect(dialog.getByRole('form', { name: 'Form klarifikasi' })).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'Jumlah jiwa', exact: true }).focus();await expect(dialog.getByRole('spinbutton', { name: 'Jumlah jiwa', exact: true })).toBeFocused();
  await expect(app).toHaveURL(/view=Klarifikasi/);
});

test('pencarian nama/desa, filter status, dan reset mempertahankan rekap', async ({ app }) => {
  await createPreview(app);
  const search = app.getByRole('textbox', { name: 'Cari posko atau desa' });
  await search.fill('cipameungpeuk');
  await expect(recapRows(app)).toHaveCount(1);
  await expect(recapRows(app)).toContainText('Posko Harapan');
  await search.fill('tidak-ada-posko');
  await expect(app.getByRole('heading', { name: 'Tidak ada posko yang cocok dengan filter' })).toBeVisible();
  await app.getByRole('button', { name: 'Reset filter' }).click();
  await app.getByLabel('Filter status').selectOption('Perlu klarifikasi');
  await expect(recapRows(app)).toHaveCount(1);
  await expect(recapRows(app)).toContainText('Posko Harapan');
  await app.getByLabel('Filter status').selectOption('Semua status');
  await expect(recapRows(app)).toHaveCount(2);
});

test('CSV berisi hanya baris terfilter dan label pratinjau', async ({ app }, testInfo) => {
  await createPreview(app);
  await app.getByLabel('Cari posko atau desa').fill('Harapan');
  const downloadEvent = app.waitForEvent('download');
  await app.getByRole('button', { name: 'Unduh CSV' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('SIGAP_rekap_posko.csv');
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const csv = await readFile(file, 'utf8');
  expect(csv.replace(/^\uFEFF/,'').startsWith('Posko,Desa,Waktu laporan,')).toBe(true);
  expect(csv).toContain('Status penyimpanan');
  expect(csv).toContain('Menunggu persetujuan');
  expect(csv).toContain('Posko Harapan');
  expect(csv).not.toContain('Posko Cibening');
  expect(csv).toContain(',98,');
  expect(csv).toContain('Perlu klarifikasi');
});

test('kebutuhan tanpa hasil kalkulasi ditandai belum diketahui', async ({ app }) => {
  await createPreview(app);
  await app.getByRole('button', { name: 'Kebutuhan', exact: true }).click();
  await expect(recapRows(app).first()).toContainText('Belum diketahui');
  await expect(app.getByText(/Acuan kebutuhan: 15 L\/orang\/hari/)).toBeVisible();
  await app.getByLabel('Jenis kebutuhan').selectOption('jamban_unit');
  await expect(app.getByRole('columnheader', { name: 'Kebutuhan jamban' })).toBeVisible();
  await expect(recapRows(app).first().getByRole('cell', { name: 'Belum diketahui', exact: true })).toHaveCount(2);
});

test('unggah txt mengisi composer tanpa otomatis mengirim', async ({ app }) => {
  let submissions = 0;
  app.on('request', request => { if (/\/messages$/.test(request.url())) submissions++; });
  await app.locator('input[type=file]').setInputFiles({ name: 'laporan.txt', mimeType: 'text/plain', buffer: Buffer.from('Posko Uji: 10 jiwa.\nButuh air bersih.') });
  await expect(composer(app)).toHaveValue('Posko Uji: 10 jiwa.\nButuh air bersih.');
  await expect(app.getByText('laporan.txt dimuat. Laporan belum dikirim.', { exact: true })).toBeVisible();
  expect(submissions).toBe(0);
});

for (const invalid of [
  { name: 'laporan.xlsx', buffer: Buffer.from('data'), error: 'Gunakan .txt/.csv, atau PDF, JPG, dan PNG untuk OCR.' },
  { name: 'kosong.txt', buffer: Buffer.alloc(0), error: 'File laporan kosong.' },
  { name: 'spasi.txt', buffer: Buffer.from('   \n'), error: 'Laporan kosong. Pilih file dengan isi laporan.' },
  { name: 'besar.txt', buffer: Buffer.alloc(200 * 1024 + 1, 'a'), error: 'Ukuran laporan maksimal 200 KiB. Bagi menjadi beberapa batch.' },
  { name: 'encoding.txt', buffer: Buffer.from([0xff, 0xfe, 0xff]), error: /Simpan ulang sebagai teks UTF-8 atau CSV UTF-8/ },
]) {
  test(`unggah ${invalid.name} ditolak dan input lama dipertahankan`, async ({ app }) => {
    await composer(app).fill('Laporan yang sedang diedit');
    await app.locator('input[type=file]').setInputFiles({ name: invalid.name, mimeType: 'text/plain', buffer: invalid.buffer });
    await expect(app.getByRole('alert').filter({ hasText: invalid.error })).toBeVisible();
    await expect(composer(app)).toHaveValue('Laporan yang sedang diedit');
  });
}

test('Ctrl+Enter mengirim sekali dan percakapan bisa diciutkan', async ({ app }) => {
  let submissions = 0;
  app.on('request', request => { if (/\/messages$/.test(request.url())) submissions++; });
  await composer(app).fill('Laporan sintetis untuk pintasan keyboard.');
  await composer(app).press('Control+Enter');
  await expect(app.getByRole('log')).toContainText('Laporan sintetis untuk pintasan keyboard.');
  await expect(composer(app)).toHaveValue('');
  expect(submissions).toBe(1);
  await app.getByRole('button', { name: 'Ciutkan percakapan' }).click();
  await expect(app.getByRole('log')).not.toBeVisible();
  await app.getByRole('button', { name: 'Buka percakapan' }).click();
  await expect(app.getByRole('log')).toBeVisible();
});

test('navigasi dan dialog dapat dipakai pada ukuran viewport proyek', async ({ app }) => {
  await createPreview(app);
  expect(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await app.getByRole('button', { name: 'Backend Mock', exact: true }).click();
  const dialog = app.getByRole('dialog', { name: 'Koneksi & Pengaturan Sesi' });
  await expect(dialog).toContainText('Simulasi lokal');
  await expect(dialog).toContainText('mock_mode');
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await expect(dialog.getByRole('button', {name:'Simpan Token'})).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await app.screenshot({ path: test.info().outputPath('rekap.png'), fullPage: true });
});

test('pengaturan menampilkan model DeepSeek tanpa kontrol token manual',async({page})=>{
  await page.route('**/api/health',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),agent:'openai',model:'oc/deepseek-v4.1-flash-free',mode:'live'}});});
  await page.goto('/');await page.getByRole('button',{name:'LLM dikonfigurasi',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Koneksi & Pengaturan Sesi'});
  await expect(dialog).toContainText('oc/deepseek-v4.1-flash-free');
  await expect(dialog.locator('input')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Simpan Token'})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>!!localStorage.getItem('sigap_token'))).toBe(true);
});

test('panel persetujuan tidak menutupi baris terakhir saat halaman digulir', async ({ app }) => {
  await createPreview(app);
  await app.getByRole('button', { name: 'Tutup pemberitahuan' }).click();
  // Cover the original desktop viewport, a short laptop screen, and mobile.
  const width = app.viewportSize()!.width;
  for (const height of [720, 600, 900]) {
    await app.setViewportSize({ width, height });
    for (const scrollY of [0, 160, 1000]) {
      await app.evaluate(y => window.scrollTo(0, y), scrollY);
      const lastRow = await recapRows(app).last().boundingBox();
      const actions = await app.locator('.review-actions').boundingBox();
      expect(lastRow).not.toBeNull();
      expect(actions).not.toBeNull();
      expect(actions!.y, `Panel overlaps the final row at ${width}×${height}, scroll ${scrollY}`).toBeGreaterThanOrEqual(lastRow!.y + lastRow!.height);
    }
  }
  await app.getByRole('button', { name: 'Posko Cibening', exact: true }).click();
  await expect(app.getByRole('region',{name:'Halaman klarifikasi posko',exact:true})).toContainText('Posko Cibening');
});
