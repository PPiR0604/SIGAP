import {test,expect,composer,sendButton} from './fixtures';

test('progres perubahan hanya tampil untuk laporan; cek, hitung, dan verifikasi mempertahankan kandidat tanpa stepper',async({page},testInfo)=>{
  let eventId=0,batchNumber=0;
  const events:{id:number;body:string}[]=[];
  const emit=(event:string,data:any)=>{const id=++eventId;events.push({id,body:`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`});};
  const record={report_id:'R001',shelter_name:'Posko Uji',village:'Desa Uji',total_people:10,male:4,female:6};
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
  await page.route('**/api/sessions/*/messages',r=>r.fulfill({status:202,json:{batch_id:String(++batchNumber).padStart(32,'0'),status:'processing',pii_summary:{totalRedacted:0}}}));
  await page.goto('/');
  const steps=page.getByRole('list',{name:/Progres batch/});
  await expect(steps).toHaveCount(0);
  emit('stored_rekap_ready',{records:[record]});
  await expect(page.getByText('1 posko · rekap tersimpan',{exact:true})).toBeVisible();
  await expect(steps).toHaveCount(0);
  await expect(page.getByText('Kirim laporan baru untuk memulai alur pemeriksaan.',{exact:false})).toHaveCount(0);

  await composer(page).fill('Laporan baru Posko Uji 10 jiwa.');await sendButton(page).click();
  await expect(composer(page)).toHaveValue('');
  const candidateBatch=String(batchNumber).padStart(32,'0'),snapshot='b'.repeat(32);
  emit('stage_changed',{batch_id:candidateBatch,stage:'tool:sigap_1_prepare_needs'});
  await expect(steps).toBeVisible();
  await expect(steps.locator('[aria-current=step]')).toContainText('Proses');
  emit('preview_ready',{batch_id:candidateBatch,snapshot_id:snapshot,records:[record]});
  emit('stage_changed',{batch_id:candidateBatch,stage:'recalculate_correction'});
  emit('approval_required',{batch_id:candidateBatch});
  emit('processing_completed',{batch_id:candidateBatch});
  await expect(steps.locator('[aria-current=step]')).toContainText('Tinjau');
  const version=await page.locator('[aria-labelledby=preview-title] .muted').textContent();

  for(const [stage,label] of [['tool:sigap_0_fetch_shelters','Membaca rekap tersimpan'],['tool:sigap_3_calculate_gap','Menghitung kebutuhan posko'],['tool:sigap_4_flag_anomalies','Memeriksa kejanggalan data']]){
    await composer(page).fill('Tolong cek informasi yang sudah ada.');await sendButton(page).click();
    await expect(composer(page)).toHaveValue('');
    const batch=String(batchNumber).padStart(32,'0');
    emit('stage_changed',{batch_id:batch,stage});
    await expect(page.locator('.chat-dock-heading [role=status]')).toHaveText(label);
    await expect(steps).toHaveCount(0);
    await expect(page.locator('[aria-labelledby=preview-title] .badge').first()).not.toHaveText('Memperbarui…');
    emit('processing_completed',{batch_id:batch});
    await expect(page.locator('.chat-dock-heading [role=status]')).toHaveText('Asisten laporan lapangan');
    expect(await page.locator('[aria-labelledby=preview-title] .muted').textContent()).toBe(version);
    await expect(steps).toHaveCount(0);
  }
  await page.screenshot({path:testInfo.outputPath('cek-tanpa-progres-simpan.png'),fullPage:true});
  let decision:any,decisionBatch='';
  await page.route('**/api/batches/*/decisions',r=>{decision=r.request().postDataJSON();decisionBatch=r.request().url().split('/').at(-2)!;return r.fulfill({status:202,json:{success:true,status:'saving'}});});
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await page.getByRole('button',{name:'Tinjau & setujui'}).click();
  await page.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
  await page.getByRole('button',{name:'Konfirmasi persetujuan'}).click();
  await expect.poll(()=>decision?.snapshot_id).toBe(snapshot);expect(decisionBatch).toBe(candidateBatch);
  await page.getByRole('button',{name:'Laporan',exact:true}).click();
  emit('readback_result',{batch_id:candidateBatch,verification_status:'verified',records:[record]});
  emit('processing_completed',{batch_id:candidateBatch});
  await expect(page.locator('[aria-labelledby=preview-title] .badge').first()).toHaveText('Tersimpan & terverifikasi');
  await expect(steps).toHaveCount(0);
  await composer(page).fill('Laporan baru setelah penyimpanan selesai.');await sendButton(page).click();
  await expect(composer(page)).toHaveValue('');
  const nextBatch=String(batchNumber).padStart(32,'0');
  emit('stage_changed',{batch_id:nextBatch,stage:'tool:sigap_1_prepare_needs'});
  await expect(steps.locator('[aria-current=step]')).toContainText('Proses');
  emit('error',{batch_id:nextBatch,message:'Validasi uji belum selesai.'});
  emit('processing_completed',{batch_id:nextBatch});
  await expect(steps).toHaveCount(0);
});
