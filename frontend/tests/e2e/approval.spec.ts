import { test, expect, createPreview, recapRows, composer, sendButton, report } from './fixtures';

test('lost approval response preserves the candidate and requires checking storage before retry',async({app})=>{
  await createPreview(app);
  let decisions=0;
  await app.route('**/api/batches/*/decisions',route=>{decisions++;return route.abort('connectionfailed');});
  await app.getByRole('button',{name:'Tinjau & setujui'}).click();
  const dialog=app.getByRole('dialog');
  await dialog.getByLabel('Keputusan R001 disability').selectOption('keep');
  await dialog.getByLabel('Saya memahami rekap masih parsial dan konflik belum selesai.').check();
  await dialog.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
  await dialog.getByRole('button',{name:'Konfirmasi persetujuan'}).click();
  await expect(dialog.getByRole('alert')).toContainText('Hasil simpan belum diketahui');
  await expect(dialog.getByRole('button',{name:'Konfirmasi persetujuan'})).toBeDisabled();
  await expect(dialog.getByRole('button',{name:'Periksa rekap tersimpan'})).toBeVisible();
  expect(decisions).toBe(1);
});

test('HITL memblokir penyimpanan sampai semua persetujuan dan keputusan field lengkap', async ({ app }) => {
  const decisions: unknown[] = [];
  app.on('request', request => {
    if (/\/decisions$/.test(request.url())) decisions.push(request.postDataJSON());
  });
  await createPreview(app);
  expect(decisions).toHaveLength(0);
  await app.getByRole('button', { name: 'Tinjau & setujui' }).click();
  const dialog = app.getByRole('dialog', { name: 'Tinjau persetujuan' });
  const confirm = dialog.getByRole('button', { name: 'Konfirmasi persetujuan' });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText('Berikan persetujuan eksplisit atas pratinjau ini.');
  expect(decisions).toHaveLength(0);
  await dialog.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText('Konfirmasi batas data parsial terlebih dahulu.');
  expect(decisions).toHaveLength(0);
  await dialog.getByLabel('Saya memahami rekap masih parsial dan konflik belum selesai.').check();
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText('Putuskan setiap usulan pengosongan field.');
  expect(decisions).toHaveLength(0);
  await dialog.getByLabel('Keputusan R001 disability').selectOption('keep');
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(app.getByText('Keputusan simulasi tercatat. Tidak ada penulisan nyata.', { exact: true })).toBeVisible();
  expect(decisions).toHaveLength(1);
  expect(decisions[0]).toMatchObject({ action: 'approve_save', partial_acknowledged: true, clear_decisions: { R001: { disability: 'keep' } } });
  await expect(app.getByText('Tersimpan dan terverifikasi di penyimpanan.', { exact: true })).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Keputusan tercatat', exact: true })).toBeDisabled();
});

test('SSE mendahului HTTP tanpa menghapus kandidat; penolakan 409 mempertahankan input', async ({ app }) => {
  let releaseResponse!: () => void;
  const hold = new Promise<void>(resolve => { releaseResponse = resolve; });
  let messages = 0;
  await app.route('**/api/sessions/*/messages', async route => {
    if (++messages === 1) {
      const response = await route.fetch();
      await hold;
      await route.fulfill({ response });
    } else {
      await route.fulfill({ status: 409, json: { error: { message: 'Batch sebelumnya masih aktif (tes regresi).' } } });
    }
  });
  try {
    await composer(app).fill(report);
    await sendButton(app).click();
    await expect(sendButton(app)).toBeDisabled();
    await app.getByRole('button', { name: 'Rekap', exact: true }).click();
    await expect(recapRows(app)).toHaveCount(2);
    await expect(app.getByRole('button', { name: 'Tinjau & setujui' })).toBeDisabled();
    releaseResponse();
    await expect(app.getByRole('button', { name: 'Tinjau & setujui' })).toBeEnabled();
    await expect(recapRows(app)).toHaveCount(2);
    await app.getByRole('button', { name: 'Laporan', exact: true }).click();
    await composer(app).fill('Laporan lanjutan tetap ada setelah 409.');
    await sendButton(app).click();
    await expect(app.getByText('Batch sebelumnya masih aktif (tes regresi).', { exact: true })).toBeVisible();
    await expect(composer(app)).toHaveValue('Laporan lanjutan tetap ada setelah 409.');
    await app.getByRole('button', { name: 'Rekap', exact: true }).click();
    await expect(recapRows(app)).toHaveCount(2);
    expect(messages).toBe(2);
  } finally { releaseResponse(); }
});

test('persetujuan yang masih berjalan mengunci pengiriman laporan berikutnya', async ({ app }) => {
  await createPreview(app);
  let releaseDecision!: () => void;
  const hold = new Promise<void>(resolve => { releaseDecision = resolve; });
  let commits = 0;
  await app.route('**/api/batches/*/decisions', async route => {
    commits++;
    await hold;
    await route.continue();
  });
  try {
    await app.getByRole('button', { name: 'Tinjau & setujui' }).click();
    const dialog = app.getByRole('dialog');
    await dialog.getByLabel('Keputusan R001 disability').selectOption('keep');
    await dialog.getByLabel('Saya memahami rekap masih parsial dan konflik belum selesai.').check();
    await dialog.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
    const requested = app.waitForRequest('**/api/batches/*/decisions');
    await dialog.getByRole('button', { name: 'Konfirmasi persetujuan' }).click();
    await requested;
    await expect(dialog.getByRole('button',{name:'Mengirim persetujuan…',exact:true})).toBeDisabled();
    await expect(dialog.getByLabel(/Saya menyetujui keputusan penyimpanan/)).toBeDisabled();
    await expect(dialog.getByRole('status')).toContainText('Menutup panel tidak membatalkan proses');
    await dialog.getByRole('button', { name: 'Tutup dialog' }).click();
    await app.getByRole('button', { name: 'Laporan', exact: true }).click();
    await composer(app).fill('Laporan berikutnya harus menunggu commit.');
    await expect(sendButton(app)).toBeDisabled();
    releaseDecision();
    await expect(sendButton(app)).toBeEnabled();
    expect(commits).toBe(1);
  } finally { releaseDecision(); }
});
