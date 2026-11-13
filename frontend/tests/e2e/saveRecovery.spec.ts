import {test,expect} from './fixtures';

test('read-back keeps the next approval locked until completion; a 409 rejection remains retryable',async({page})=>{
  let cursor=0;
  const events:{id:number;body:string}[]=[],decisions:string[]=[];
  const emit=(event:string,data:any)=>{const id=++cursor;events.push({id,body:`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`});};
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
  await page.route('**/api/batches/*/decisions',r=>{
    const batch=r.request().url().split('/').at(-2)!;decisions.push(batch);
    return r.fulfill(decisions.length===2?{status:409,json:{error:{code:'PROCESSING_IN_PROGRESS',message:'Tunggu hingga proses kandidat selesai.'}}}:{status:202,json:{success:true,status:'saving'}});
  });
  await page.goto('/?view=Laporan');
  const a={batch_id:'source-a',report_id:'R001',shelter_id:'shelter-a',shelter_name:'Sejahtera',village:'Karangmulya',total_people:44,male:20,female:24};
  const b={...a,batch_id:'source-b',report_id:'R002',shelter_id:'shelter-b',village:'Cibening',total_people:32,male:15,female:17};
  for(const [batch,record]of [['a'.repeat(32),a],['b'.repeat(32),b]]as const){emit('preview_ready',{batch_id:batch,snapshot_id:batch,records:[record]});emit('processing_completed',{batch_id:batch});}
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  const selection=page.getByLabel('Perubahan yang akan disimpan');
  await expect(selection.locator('option')).toHaveCount(2);
  await selection.selectOption('a'.repeat(32));
  await page.getByRole('button',{name:'Tinjau & setujui',exact:true}).click();
  await page.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
  await page.getByRole('button',{name:'Konfirmasi persetujuan',exact:true}).click();
  await expect.poll(()=>decisions.length).toBe(1);
  emit('readback_result',{batch_id:'a'.repeat(32),verification_status:'verified',records:[a]});
  await expect(selection).toHaveValue('b'.repeat(32));
  await expect(page.getByRole('button',{name:'Tinjau & setujui',exact:true})).toBeDisabled();
  emit('processing_completed',{batch_id:'a'.repeat(32)});
  await expect(page.getByRole('button',{name:'Tinjau & setujui',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Tinjau & setujui',exact:true}).click();
  await page.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
  await page.getByRole('button',{name:'Konfirmasi persetujuan',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Tunggu hingga proses kandidat selesai.');
  await expect(page.getByRole('dialog')).not.toContainText('Hasil simpan belum diketahui');
  await expect(page.getByRole('button',{name:'Konfirmasi persetujuan',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Konfirmasi persetujuan',exact:true}).click();
  await expect.poll(()=>decisions.length).toBe(3);
  emit('readback_result',{batch_id:'b'.repeat(32),verification_status:'verified',records:[a,b]});
  emit('processing_completed',{batch_id:'b'.repeat(32)});
  await expect(selection).toHaveCount(0);
});

test('a note-only correction carries the selected shelter identity and structured note',async({page})=>{
  let cursor=0;
  const events:{id:number;body:string}[]=[],messages:any[]=[];
  const emit=(event:string,data:any)=>{const id=++cursor;events.push({id,body:`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`});};
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
  await page.route('**/api/sessions/*/messages',r=>{messages.push(r.request().postDataJSON());return r.fulfill({status:202,json:{batch_id:'c'.repeat(32),status:'processing'}});});
  await page.goto('/?view=Laporan');
  const record={batch_id:'source-cibening',report_id:'R002',shelter_id:'cibening',shelter_name:'Sejahtera',village:'Cibening',total_people:32,male:15,female:17};
  emit('preview_ready',{batch_id:'b'.repeat(32),snapshot_id:'b'.repeat(32),records:[record]});
  emit('processing_completed',{batch_id:'b'.repeat(32)});
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(page.getByLabel('Perubahan yang akan disimpan')).toBeVisible();
  await page.getByRole('button',{name:'Sejahtera',exact:true}).click();
  const form=page.getByRole('form',{name:'Form klarifikasi'});
  await form.getByRole('button',{name:'Catatan',exact:true}).click();
  await page.getByLabel('Catatan klarifikasi (opsional)',{exact:true}).fill('Stok air sudah diperiksa ulang; jumlah tetap sesuai laporan.');
  await form.getByRole('button',{name:'Validasi perubahan',exact:true}).click();
  await expect.poll(()=>messages.length).toBe(1);
  expect(messages[0].correction.target).toEqual({report_id:'R002',batch_id:'source-cibening',name:'Sejahtera',village:'Cibening'});
  expect(messages[0].correction.changes).toEqual({note:'Stok air sudah diperiksa ulang; jumlah tetap sesuai laporan.'});
});
