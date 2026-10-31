import {test,expect} from './fixtures';

test('klarifikasi desa memakai target server walau nama desa berubah dan posko lain bernama sama',async({page})=>{
  const oldBatch='a'.repeat(32),newBatch='b'.repeat(32);
  const original={batch_id:oldBatch,report_id:'R002',shelter_name:'Posko Harapan',village:'',total_people:98,male:43,female:55};
  const other={...original,batch_id:'c'.repeat(32),village:'Sukamaju',urgent_needs:['popok']};
  const changed={...original,batch_id:'d'.repeat(32),report_id:'R001',shelter_name:'Posko Harapan Utama',village:'Cibineng',urgent_needs:['selimut','sabun'],update_target:{batch_id:oldBatch,report_id:'R002'}};
  const frame=(id:number,event:string,data:any)=>`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent=false,writes=0;
  page.on('request',r=>{if(/\/decisions$/.test(r.url()))writes++;});
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:sent?
    frame(2,'preview_ready',{batch_id:newBatch,snapshot_id:'1'.repeat(32),records:[changed]})+frame(3,'approval_required',{batch_id:newBatch})+frame(4,'processing_completed',{batch_id:newBatch}):
    frame(1,'stored_rekap_ready',{records:[original,other]})}));
  let message='';
  await page.route('**/api/sessions/*/messages',r=>{message=r.request().postDataJSON().text;sent=true;return r.fulfill({status:202,json:{batch_id:newBatch,status:'accepted',pii_summary:{totalRedacted:0}}});});
  await page.goto('/?view=Laporan');await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button',{name:'Posko Harapan',exact:true}).first().click();
  const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});
  if(await dialog.getByRole('button',{name:'Tulis klarifikasi'}).count())await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();
  await dialog.getByLabel('Nama posko',{exact:true}).fill('Posko Harapan Utama');
  await dialog.getByLabel('Desa',{exact:true}).fill('Cibineng');
  await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Kebutuhan & stok',exact:true}).click();await dialog.getByLabel('Kebutuhan yang dilaporkan',{exact:true}).fill('sabun\nselimut');
  await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
  await expect(dialog.getByRole('status')).toContainText('Kandidat baru diterima');
  await expect(dialog.locator('.detail-meta')).toContainText('Cibineng');
  await expect(dialog.getByRole('heading',{name:'Posko Harapan Utama',exact:true})).toBeVisible();
  const notice=dialog.getByRole('region',{name:'Perubahan dan peringatan posko'});
  await expect(notice).toContainText('Perubahan belum disimpan');
  await expect(notice).toContainText('Posko Harapan → Posko Harapan Utama');
  await expect(notice.locator('details')).not.toHaveAttribute('open','');
  await notice.locator('summary').click();
  await expect(notice.locator('details')).toHaveAttribute('open','');
  await expect(notice).toContainText('Perubahan dari rekap tersimpan');
  expect(message).toContain('ubah nama posko ini menjadi "Posko Harapan Utama".\n');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Tulis klarifikasi'})).toBeEnabled();
  expect(message).toContain(`laporan R002 (Posko Harapan) batch ${oldBatch}`);
  await dialog.getByRole('button',{name:'Kembali',exact:true}).click();
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr').first()).toContainText('Cibineng');
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr').nth(1)).toContainText('Sukamaju');
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr').nth(1)).toContainText('popok');
  await page.getByRole('button',{name:'Tinjau & setujui',exact:true}).click();
  const summary=page.getByRole('region',{name:'Ringkasan perubahan',exact:true});await expect(summary).toContainText('Nama posko');await expect(summary).toContainText('Desa belum diketahui');await expect(summary).toContainText('Cibineng');await expect(summary).toContainText('selimut, sabun');
  expect(writes).toBe(0);
});
