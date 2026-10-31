import {test,expect} from './fixtures';
import type {Page} from '@playwright/test';

async function workspace(page:Page){
  let id=0;
  const events:{id:number;body:string}[]=[];
  const emit=(type:string,data:any)=>{const next=++id;events.push({id:next,body:`id: ${next}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`});};
  const original={batch_id:'stored-a',report_id:'R002',shelter_name:'Posko Harapan',village:'Sukamaju',total_people:10,male:4,female:6,elderly:1,disability:0,urgent_needs:['air bersih']};
  const other={...original,batch_id:'stored-b',report_id:'R001',shelter_name:'Posko Lain',village:'Cipandan',total_people:20,male:9,female:11};
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
  await page.goto('/');await page.getByRole('button',{name:'Rekap',exact:true}).click();
  emit('stored_rekap_ready',{records:[original,other]});
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(2);
  const form=async()=>{
    await page.getByRole('button',{name:'Posko Harapan',exact:true}).click();
    const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});
    if(await dialog.getByRole('button',{name:'Tulis klarifikasi'}).count())await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();
    return dialog;
  };
  return {emit,original,other,form};
}

test('hasil hitung yang tiba saat menulis tidak menghapus angka dan catatan draf',async({page})=>{
  const {emit,original,form}=await workspace(page);
  const dialog=await form();
  await dialog.getByRole('spinbutton',{name:'Laki-laki',exact:true}).fill('5');
  await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Catatan',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Catatan klarifikasi (opsional)'}).fill('Draf belum dikirim, jangan hilangkan.');
  emit('calculation_ready',{batch_id:'read-calculation',shelters:[{shelter_name:original.shelter_name,village:original.village,needs:{air_liter_per_hari:{value:150}}}]});
  await dialog.getByRole('group',{name:'Bagian data pembanding'}).getByRole('button',{name:'Perhitungan',exact:true}).click();await expect(dialog.getByRole('region',{name:'Hasil perhitungan kebutuhan'})).toContainText('150 L/hari');
  await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Data posko',exact:true}).click();await expect(dialog.getByRole('spinbutton',{name:'Laki-laki',exact:true})).toHaveValue('5');
  await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Catatan',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'Catatan klarifikasi (opsional)'})).toHaveValue('Draf belum dikirim, jangan hilangkan.');
});

test('koreksi nama terikat target memperbarui judul, baris dan hasil hitung posko yang sama',async({page},testInfo)=>{
  const {emit,original,form}=await workspace(page);
  const batch='d'.repeat(32);
  await page.route('**/api/sessions/*/messages',r=>r.fulfill({status:202,json:{batch_id:batch,status:'accepted',pii_summary:{totalRedacted:0}}}));
  const dialog=await form();
  await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Catatan',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Catatan klarifikasi (opsional)'}).fill('Ubah nama posko ini menjadi Posko Harapan Utama.');
  await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
  emit('preview_ready',{batch_id:batch,snapshot_id:'e'.repeat(32),records:[{...original,batch_id:'new',report_id:'R001',shelter_name:'Posko Harapan Utama',update_target:{batch_id:original.batch_id,report_id:original.report_id}}]});
  emit('calculation_ready',{batch_id:batch,shelters:[{shelter_name:'Posko Harapan Utama',village:original.village,needs:{air_liter_per_hari:{value:150}}}]});
  emit('processing_completed',{batch_id:batch});
  await expect(dialog.getByRole('heading',{name:'Posko Harapan Utama',exact:true})).toBeVisible();
  await dialog.getByRole('group',{name:'Bagian data pembanding'}).getByRole('button',{name:'Perhitungan',exact:true}).click();await expect(dialog.getByRole('region',{name:'Hasil perhitungan kebutuhan'})).toContainText('150 L/hari');
  await dialog.getByRole('button',{name:'Kembali',exact:true}).click();
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Posko Harapan Utama',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Posko Lain',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('rename-kandidat.png'),fullPage:true});
});

test('nama posko baru yang mirip tidak menimpa posko lama dalam desa yang sama',async({page})=>{
  const {emit,original}=await workspace(page);
  emit('preview_ready',{batch_id:'f'.repeat(32),snapshot_id:'a'.repeat(32),records:[{...original,batch_id:'new',report_id:'R001',shelter_name:'Posko Harapan Baru',total_people:12,male:5,female:7,storage_baseline:{row:null}}]});
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(3);
  const old=page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr').filter({has:page.getByRole('button',{name:'Posko Harapan',exact:true})});
  const added=page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr').filter({has:page.getByRole('button',{name:'Posko Harapan Baru',exact:true})});
  await expect(old.locator('.population')).toHaveText('10');
  await expect(added.locator('.population')).toHaveText('12');
});
