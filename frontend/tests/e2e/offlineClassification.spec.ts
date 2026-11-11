import {test,expect} from '@playwright/test';

test('formulir offline menyimpan angka manual tanpa mengirim ke server dan bertahan setelah reload',async({page})=>{
 let sends=0;page.on('request',r=>{if(r.method()==='POST'&&/\/messages$/.test(r.url()))sends++;});
 await page.goto('/offline');
 await page.getByRole('button',{name:'Buat laporan lewat formulir'}).click();
 await page.getByLabel('Nama posko',{exact:true}).fill('Posko Form Offline');
 await page.getByLabel('Desa',{exact:true}).fill('Desa Uji');
 await page.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('20');
 await page.getByRole('spinbutton',{name:'Laki-laki',exact:true}).fill('8');
 await page.getByRole('spinbutton',{name:'Perempuan',exact:true}).fill('12');
 await page.getByRole('button',{name:'Simpan draf di perangkat'}).click();
 await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
 await expect(page.getByText('Draf tersimpan di antrean perangkat.',{exact:false})).toBeVisible();
 await page.reload();
 await expect(page.locator('.offline-report-text')).toContainText('jumlah jiwa: 20');
 await expect(page.locator('.offline-report-text')).toContainText('laki-laki: 8');
 expect(sends).toBe(0);
});

test('koreksi offline dikirim sebagai perubahan terstruktur dengan identitas tetap',async({page})=>{
 await page.goto('/offline');
 await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('sigap-offline-reports',2);r.onsuccess=()=>resolve(r.result);});
  await new Promise<void>(resolve=>{const tx=db.transaction('reports','readwrite');tx.objectStore('reports').add({id:'stable-offline-request',text:'Koreksi laporan sintetis: jumlah jiwa 22.',createdAt:new Date().toISOString(),prepared:false,correction:{owner:'local',contextId:'posko-sumedang',payload:{target:{report_id:'R001',batch_id:'stored-a',name:'Posko Salinan',village:'Desa Uji'},base_key:'original-base',changes:{people:22}}}});tx.oncomplete=()=>{db.close();resolve();};});
 });
 let payload:any;
 await page.route('**/api/sessions/*/messages',r=>{payload=r.request().postDataJSON();return r.fulfill({status:409,json:{error:{message:'Data asal sudah berubah, muat ulang untuk meninjau konflik.'}}});});
 await page.goto('/');
 await page.getByRole('navigation',{name:'Navigasi utama'}).getByRole('button',{name:'Laporan',exact:true}).click();
 await page.getByText('Antrean laporan di perangkat',{exact:true}).first().click();
 await page.getByRole('button',{name:'Siapkan untuk diproses'}).click();
 await page.getByRole('button',{name:'Kirim',exact:true}).click();
 await expect.poll(()=>payload?.correction?.changes?.people).toBe(22);
 expect(payload.request_id).toBe('stable-offline-request');expect(payload.correction.base_key).toBe('original-base');
 await expect(page.getByRole('alert')).toContainText('Data asal sudah berubah');
 await expect(page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'})).toHaveValue('Koreksi laporan sintetis: jumlah jiwa 22.');
});

test('koreksi salinan offline mempertahankan identitas sumber, akun dan nilai dasar',async({page})=>{
 await page.goto('/offline');
 await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sigap-offline-reports',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('shelters','readwrite');tx.objectStore('shelters').put({id:'copy-1',owner:'user-original',contextId:'posko-original',savedAt:new Date().toISOString(),rows:[{id:'R001',sourceBatchId:'batch-original',calculationKey:'original-base',name:'Posko Salinan',village:'Desa Uji',people:20,male:8,female:12,elderly:null,disability:null,status:'Perlu klarifikasi',needs:[],time:'Kemarin',source:'Laporan sintetis',water:null,gap:null,note:''}]});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 });
 await page.reload();
 await page.getByRole('button',{name:'Klarifikasi Posko Salinan · Desa Uji'}).click();
 await expect(page.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true})).toHaveValue('20');
 await page.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('22');
 await page.getByRole('button',{name:'Simpan draf di perangkat'}).click();
 await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
 const result=await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('sigap-offline-reports',2);r.onsuccess=()=>resolve(r.result);});
  return new Promise<any>(resolve=>{const tx=db.transaction('reports','readonly'),r=tx.objectStore('reports').getAll();tx.oncomplete=()=>{db.close();resolve(r.result[0]);};});
 });
 expect(result.correction).toMatchObject({owner:'user-original',contextId:'posko-original',payload:{base_key:'original-base',target:{report_id:'R001',batch_id:'batch-original'},changes:{people:22}}});
 expect(result.delivery).toBeUndefined();
 await page.goto('/');
 await page.getByRole('navigation',{name:'Navigasi utama'}).getByRole('button',{name:'Laporan',exact:true}).click();
 await page.getByText('Antrean laporan di perangkat',{exact:true}).first().click();
 await page.getByRole('button',{name:'Siapkan untuk diproses'}).click();
 await expect(page.getByRole('alert')).toContainText('akun dan pos komando asal');
 await expect(page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'})).toHaveValue('');
});
