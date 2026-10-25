import {test,expect} from './fixtures';

test('klarifikasi desa memakai target server walau nama desa berubah dan posko lain bernama sama',async({page})=>{
  const oldBatch='a'.repeat(32),newBatch='b'.repeat(32);
  const original={batch_id:oldBatch,report_id:'R002',shelter_name:'Posko Harapan',village:'',total_people:98,male:43,female:55};
  const other={...original,batch_id:'c'.repeat(32),village:'Sukamaju',urgent_needs:['popok']};
  const changed={...original,batch_id:'d'.repeat(32),report_id:'R001',village:'Cibineng',update_target:{batch_id:oldBatch,report_id:'R002'}};
  const frame=(id:number,event:string,data:any)=>`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent=false,writes=0;
  page.on('request',r=>{if(/\/decisions$/.test(r.url()))writes++;});
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:sent?
    frame(2,'preview_ready',{batch_id:newBatch,snapshot_id:'1'.repeat(32),records:[changed]})+frame(3,'approval_required',{batch_id:newBatch})+frame(4,'processing_completed',{batch_id:newBatch}):
    frame(1,'stored_rekap_ready',{records:[original,other]})}));
  let message='';
  await page.route('**/api/sessions/*/messages',r=>{message=r.request().postDataJSON().text;sent=true;return r.fulfill({status:202,json:{batch_id:newBatch,status:'accepted',pii_summary:{totalRedacted:0}}});});
  await page.goto('/');await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button',{name:'Posko Harapan',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'Detail laporan'});
  await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();
  await dialog.getByRole('textbox',{name:'Catatan klarifikasi (opsional)'}).fill('Desa posko ini adalah Cibineng.');
  await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
  await expect(dialog.getByRole('status')).toContainText('Kandidat baru diterima');
  await expect(dialog.locator('.detail-meta')).toContainText('Cibineng');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Tulis klarifikasi'})).toBeEnabled();
  expect(message).toContain(`laporan R002 (Posko Harapan) batch ${oldBatch}`);
  await dialog.getByRole('button',{name:'Tutup dialog'}).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody tr').first()).toContainText('Cibineng');
  await expect(page.locator('tbody tr').nth(1)).toContainText('Sukamaju');
  await expect(page.locator('tbody tr').nth(1)).toContainText('popok');
  expect(writes).toBe(0);
});
