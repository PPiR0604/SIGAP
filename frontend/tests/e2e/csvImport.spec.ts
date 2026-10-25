import {test,expect,composer,sendButton} from './fixtures';
test('CSV upload is reviewed before send, retains filename, and never writes automatically',async({app})=>{
  const csv='posko,desa,jumlah_jiwa\nPosko A,Desa A,10\nPosko B,Desa B,20';
  let decisions=0;app.on('request',r=>{if(/\/decisions$/.test(r.url()))decisions++;});
  await app.locator('input[type=file]').setInputFiles({name:'rekap.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await expect(composer(app)).toHaveValue(csv);
  await expect(app.getByRole('status').filter({hasText:'Berkas: rekap.csv'})).toBeVisible();
  const sent=app.waitForRequest('**/api/sessions/*/messages');await sendButton(app).click();
  expect((await sent).postDataJSON()).toMatchObject({filename:'rekap.csv',text:csv});
  await app.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(app.getByRole('button',{name:'Posko Harapan',exact:true})).toBeVisible();expect(decisions).toBe(0);
});

test('every stored-data conflict must be explicitly selected before saving',async({page})=>{
  const batch='a'.repeat(32),snapshot='b'.repeat(32);
  const frame=(id:number,event:string,data:any)=>`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:frame(1,'preview_ready',{batch_id:batch,snapshot_id:snapshot,records:[{report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:12,storage_conflicts:[{field:'total_people',previous_value:10,incoming_value:12,previous_reported_at:'2026-10-22 10:00',incoming_reported_at:'2026-10-22 11:00'}]}]})+frame(2,'approval_required',{batch_id:batch})+frame(3,'processing_completed',{batch_id:batch})}));
  let saved:any;await page.route('**/api/batches/*/decisions',async r=>{saved=r.request().postDataJSON();await r.fulfill({status:202,json:{success:true,status:'saving'}});});
  await page.goto('/');await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);await page.getByRole('button',{name:'Tinjau & setujui'}).click();
  const dialog=page.getByRole('dialog',{name:'Tinjau persetujuan'});
  await dialog.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
  await dialog.getByLabel('Saya memahami rekap masih parsial dan konflik belum selesai.').check();
  await dialog.getByRole('button',{name:'Konfirmasi persetujuan'}).click();
  await expect(dialog.getByRole('alert')).toHaveText('Putuskan setiap konflik dengan rekap tersimpan.');expect(saved).toBeUndefined();
  await expect(dialog.getByRole('region',{name:'Konflik dengan rekap tersimpan'})).toContainText('Tersimpan: 10');
  await dialog.getByRole('combobox',{name:'Konflik R001 total_people'}).selectOption('keep');
  await dialog.getByRole('button',{name:'Konfirmasi persetujuan'}).click();
  await expect.poll(()=>saved?.conflict_decisions).toEqual({R001:{total_people:'keep'}});
});

test('corrected demographic counts show pending approval and open the save review directly from detail',async({page})=>{
  const batch='c'.repeat(32),snapshot='d'.repeat(32);
  const frame=(id:number,event:string,data:any)=>`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const source={batch_id:'old',report_id:'R002',shelter_name:'Posko Harapan',village:'',total_people:98,male:45,female:55};
  const corrected={...source,batch_id:batch,report_id:'R001',male:43,update_target:{batch_id:'old',report_id:'R002'},storage_conflicts:[{field:'male',previous_value:45,incoming_value:43}],validation_issues:[{field:'storage_conflicts',reason:'Pilih nilai lama atau baru.'}]};
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:frame(1,'stored_rekap_ready',{records:[source]})+frame(2,'preview_ready',{batch_id:batch,snapshot_id:snapshot,records:[corrected]})+frame(3,'approval_required',{batch_id:batch})+frame(4,'processing_completed',{batch_id:batch})}));
  let decisions=0;page.on('request',r=>{if(/\/decisions$/.test(r.url()))decisions++;});
  await page.goto('/');await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(page.locator('tbody tr')).toContainText('belum disimpan');
  await expect(page.locator('tbody tr')).toContainText('Menunggu persetujuan');
  await page.getByRole('button',{name:'Posko Harapan',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Detail laporan'});
  await expect(detail.locator('.detail-grid').first()).toContainText('43');
  await expect(detail).not.toContainText('Dibaca dari rekap yang sudah tersimpan.');
  await expect(detail.getByText('Belum dilaporkan',{exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'Tinjau & simpan perubahan'}).click();
  const review=page.getByRole('dialog',{name:'Tinjau persetujuan'});
  await expect(review.getByRole('combobox',{name:'Konflik R001 male'})).toBeVisible();
  await expect(review).toContainText('Tersimpan: 45');
  await expect(review).toContainText('Laporan baru: 43');
  expect(decisions).toBe(0);
});
