import { test, expect, createPreview, composer } from './fixtures';

async function openForm(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Posko Harapan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Detail laporan' });
  await dialog.getByRole('button', { name: 'Tulis klarifikasi' }).click();
  return dialog;
}

test('klarifikasi dikirim dari detail, menampilkan hasil server, dan mempertahankan draf chat', async ({ app }) => {
  await createPreview(app);
  await app.getByRole('button', { name: 'Laporan', exact: true }).click();
  await composer(app).fill('Draf chat yang belum dikirim');
  await app.getByRole('button', { name: 'Rekap', exact: true }).click();
  const dialog = await openForm(app);
  await dialog.getByRole('textbox', { name: 'Catatan klarifikasi (opsional)' }).fill('Sudah diperiksa ulang oleh petugas.');
  const request = app.waitForRequest('**/api/sessions/*/messages');
  await dialog.getByRole('button', { name: 'Validasi perubahan' }).click();
  const payload = (await request).postDataJSON();
  expect(payload.text).toMatch(/^Mohon klarifikasi laporan R001 \(Posko Harapan\)/);
  expect(payload.text).toContain('Sudah diperiksa ulang oleh petugas.');
  await expect(dialog.getByRole('status')).toContainText('Pratinjau sintetis diterima');
  await expect(dialog.getByRole('button', { name: 'Tulis klarifikasi' })).toBeEnabled();
  // The canonical result still displays the backend's 45.
  await expect(dialog.locator('.detail-grid').filter({ hasText: 'Laki-laki' })).toContainText('45');
  await expect(dialog).toBeVisible();
  await expect(app.getByRole('navigation').getByRole('button', { name: 'Rekap', exact: true })).toHaveAttribute('aria-current', 'page');
  await app.screenshot({ path: test.info().outputPath('klarifikasi-hasil.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Tutup dialog' }).click();
  await app.getByRole('button', { name: 'Laporan', exact: true }).click();
  await expect(composer(app)).toHaveValue('Draf chat yang belum dikirim');
});

test('validasi form menolak angka negatif, pecahan, dan perubahan kosong sebelum request', async ({ app }) => {
  await createPreview(app);
  let requests = 0;
  app.on('request', request => { if (/\/messages$/.test(request.url())) requests++; });
  const dialog = await openForm(app);
  const male = dialog.getByRole('spinbutton', { name: 'Laki-laki', exact: true });
  for (const invalid of ['-1', '3.5']) {
    await male.fill(invalid);
    await dialog.getByRole('button', { name: 'Validasi perubahan' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Laki-laki harus berupa bilangan bulat nol atau lebih.');
  }
  await male.fill('');
  await dialog.getByRole('button', { name: 'Validasi perubahan' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Ubah setidaknya satu angka atau tulis catatan klarifikasi.');
  expect(requests).toBe(0);
  await male.fill('0');
  await app.screenshot({ path: test.info().outputPath('klarifikasi-form.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(dialog.getByRole('form')).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test('penolakan 409 tampil di detail dan mempertahankan angka koreksi untuk dikirim ulang', async ({ app }) => {
  await createPreview(app);
  let decisions = 0;
  app.on('request', request => { if (/\/decisions$/.test(request.url())) decisions++; });
  await app.route('**/api/sessions/*/messages', route => route.fulfill({ status: 409, json: { error: { message: 'Validasi lain masih berjalan.' } } }));
  const dialog = await openForm(app);
  await dialog.getByRole('spinbutton', { name: 'Laki-laki', exact: true }).fill('43');
  await dialog.getByRole('button', { name: 'Validasi perubahan' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Validasi lain masih berjalan.');
  await expect(dialog.getByRole('spinbutton', { name: 'Laki-laki', exact: true })).toHaveValue('43');
  await expect(dialog.getByRole('button', { name: 'Validasi perubahan' })).toBeEnabled();
  await expect(dialog).toBeVisible();
  expect(decisions).toBe(0);
});

test('SSE klarifikasi sebelum HTTP tetap tampil di detail dan pengiriman ganda terkunci', async ({ app }) => {
  await createPreview(app);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await app.route('**/api/sessions/*/messages', async route => {
    requests++;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    const dialog = await openForm(app);
    await dialog.getByRole('textbox', { name: 'Catatan klarifikasi (opsional)' }).fill('Periksa kembali sumber laporan ini.');
    await dialog.getByRole('button', { name: 'Validasi perubahan' }).click();
    await expect(dialog.getByRole('status')).toContainText('Pratinjau sintetis diterima');
    await expect(dialog.getByRole('button', { name: 'Memvalidasi…' })).toBeDisabled();
    expect(requests).toBe(1);
    release();
    await expect(dialog.getByRole('button', { name: 'Tulis klarifikasi' })).toBeEnabled();
    await expect(dialog).toBeVisible();
  } finally { release(); }
});

test('angka yang diabaikan validator tidak diklaim berhasil dan draf koreksi dipertahankan', async ({ app }) => {
  await createPreview(app);
  const dialog = await openForm(app);
  await dialog.getByRole('spinbutton', { name: 'Laki-laki', exact: true }).fill('43');
  const request = app.waitForRequest('**/api/sessions/*/messages');
  await dialog.getByRole('button', { name: 'Validasi perubahan' }).click();
  expect((await request).postDataJSON().text).toContain('laki-laki: 43');
  // The mock deliberately keeps the old value instead of applying this correction.
  await expect(dialog.getByRole('alert')).toContainText('belum menerapkan seluruh angka');
  await expect(dialog.getByRole('spinbutton', { name: 'Laki-laki', exact: true })).toHaveValue('43');
  await expect(dialog.locator('.detail-grid')).toContainText('45');
  await expect(dialog.getByRole('button', { name: 'Validasi perubahan' })).toBeEnabled();
});

for(const automatic of [false,true])test(`klarifikasi satu desa mempertahankan kebutuhan desa lain${automatic?' dan otomatis menghitung ulang perubahan':''}`,async({page},testInfo)=>{
  const records=[{report_id:'R001',batch_id:'a'.repeat(32),shelter_name:'Posko Harapan',village:'Desa A',total_people:10,male:4,female:6,urgent_needs:['air bersih']},
    {report_id:'R002',batch_id:'a'.repeat(32),shelter_name:'Posko Lain',village:'Desa B',total_people:20,male:9,female:11,urgent_needs:['beras']}];
  const corrected=[{...records[0],batch_id:'b'.repeat(32),total_people:automatic?12:10,male:automatic?5:3,female:7},records[1]];
  const frame=(id:number,event:string,data:any)=>`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let ready!:()=>void;const correction=new Promise<void>(resolve=>{ready=resolve;});let correctionSent=false;
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
  await page.route('**/api/sessions/*/events',async route=>{
    if(!correctionSent)await route.fulfill({contentType:'text/event-stream',body:
      frame(1,'preview_ready',{batch_id:'a'.repeat(32),snapshot_id:'1'.repeat(32),records})+
      frame(2,'calculation_ready',{shelters:records.map(r=>({...r,needs:{air_liter_per_hari:{value:r.total_people*15}},gaps:{air_liter_per_hari:0}}))})});
    else{await correction;await route.fulfill({contentType:'text/event-stream',body:
      frame(3,'preview_ready',{batch_id:'b'.repeat(32),snapshot_id:'2'.repeat(32),records:corrected})+
      (automatic?frame(4,'stage_changed',{batch_id:'b'.repeat(32),stage:'recalculate_correction'})+
        frame(5,'calculation_ready',{batch_id:'b'.repeat(32),snapshot_id:'2'.repeat(32),automatic_recalculation:true,shelters:corrected.map(r=>({...r,needs:{air_liter_per_hari:{value:r.total_people*15}},gaps:{air_liter_per_hari:null}}))}):'')+
      frame(6,'approval_required',{batch_id:'b'.repeat(32)})+frame(7,'processing_completed',{batch_id:'b'.repeat(32)})});}
  });
  await page.route('**/api/sessions/*/messages',async route=>{correctionSent=true;await route.fulfill({status:202,json:{batch_id:'b'.repeat(32),status:'accepted',pii_summary:{totalRedacted:0}}});ready();});
  try{
    await page.goto('/');await page.getByRole('button',{name:'Rekap',exact:true}).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.getByRole('button',{name:'Kebutuhan',exact:true}).click();
    const other=page.getByRole('row').filter({has:page.getByRole('button',{name:'Posko Lain',exact:true})});
    await expect(other).toContainText('300 L/hari');
    await page.getByRole('button',{name:'Posko',exact:true}).click();
    const dialog=await openForm(page);
    if(automatic)await dialog.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('12');
    await dialog.getByRole('spinbutton',{name:'Laki-laki',exact:true}).fill(automatic?'5':'3');
    await dialog.getByRole('spinbutton',{name:'Perempuan',exact:true}).fill('7');
    await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
    await expect(dialog.getByRole('status')).toContainText('Kandidat baru diterima');
    await expect(dialog.getByRole('button',{name:'Tulis klarifikasi'})).toBeEnabled();
    if(automatic){
      await expect(dialog.getByRole('status')).toContainText('Kebutuhan sudah dihitung ulang');
      await expect(dialog.getByRole('region',{name:'Hasil perhitungan kebutuhan'})).toContainText('180 L/hari');
    }
    await dialog.getByRole('button',{name:'Tutup dialog'}).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);await expect(other).toContainText('beras');
    await page.getByRole('button',{name:'Kebutuhan',exact:true}).click();
    await expect(other).toContainText('300 L/hari');
    const changed=page.getByRole('row').filter({has:page.getByRole('button',{name:'Posko Harapan',exact:true})});
    await expect(changed).toContainText(automatic?'180 L/hari':'Belum diketahui');
    await page.screenshot({path:testInfo.outputPath('kebutuhan-desa-lain.png'),fullPage:true});
  }finally{ready();}
});
