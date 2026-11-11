import {test,expect} from '@playwright/test';

async function cachedExample(page:import('@playwright/test').Page){
 await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('sigap-offline-reports',2);r.onsuccess=()=>resolve(r.result);});
  await new Promise<void>(resolve=>{const tx=db.transaction('shelters','readwrite');tx.objectStore('shelters').put({id:'offline-test-copy',owner:'owner-test',contextId:'context-test',savedAt:'2026-11-10T08:00:00Z',rows:[{id:'R001',sourceBatchId:'stored-test',calculationKey:'original-key',name:'Posko Offline',village:'Desa Uji',people:20,male:8,female:12,elderly:null,disability:null,status:'Perlu klarifikasi',needs:[],time:'08:00',source:'Laporan sintetis',water:null,gap:null,note:''}]});tx.oncomplete=()=>{db.close();resolve();};});
 });
}

test('antrean tetap tersedia setelah koneksi terputus dan halaman dimuat ulang',async({page,context})=>{
  await page.goto('/offline');
  await expect(page.getByRole('status')).toContainText('Antarmuka tersedia', {timeout:15000});
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading',{name:'SIGAP · Catatan offline'})).toBeVisible();
  await page.getByLabel('Catat laporan').fill('Laporan sintetis: Posko Offline 10 jiwa, stok belum diketahui.');
  await page.getByRole('button',{name:'Simpan di perangkat'}).click();
  await expect(page.getByText('Tersimpan di perangkat · belum diproses')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Laporan sintetis: Posko Offline 10 jiwa, stok belum diketahui.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'SIGAP · Catatan offline'})).toBeVisible();
  await expect(page.getByText('Laporan sintetis: Posko Offline 10 jiwa, stok belum diketahui.')).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button',{name:'Hapus dari perangkat'}).click();
  await page.getByRole('button',{name:'Batal',exact:true}).click();
  await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
  await page.getByRole('button',{name:'Hapus dari perangkat'}).click();
  await page.getByRole('button',{name:'Ya, hapus salinan'}).click();
  await expect(page.getByText('0 laporan di perangkat')).toBeVisible();
});

test('draf dari formulir muncul di tab offline lain tanpa reload',async({page,context})=>{
 await page.goto('/offline');await expect(page.getByRole('status')).toContainText('Antarmuka tersedia');
 const other=await context.newPage();await other.goto('/offline');await expect(other.getByText('0 laporan di perangkat')).toBeVisible();
 await context.setOffline(true);
 await page.getByRole('button',{name:'Buat laporan lewat formulir'}).click();
 await page.getByLabel('Nama posko',{exact:true}).fill('Posko Dua Tab');await page.getByLabel('Desa',{exact:true}).fill('Desa Uji');
 await page.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('10');
 await page.getByRole('button',{name:'Simpan draf di perangkat'}).click();
 await expect(other.getByText('1 laporan di perangkat')).toBeVisible();
});

test('koreksi offline yang hanya berisi catatan tidak kehilangan isi',async({page,context})=>{
 await page.goto('/offline');await expect(page.getByRole('status')).toContainText('Antarmuka tersedia');
 await cachedExample(page);await context.setOffline(true);await page.reload();
 await page.getByRole('button',{name:'Klarifikasi Posko Offline · Desa Uji'}).click();
 await page.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Catatan',exact:true}).click();
 await page.getByLabel('Catatan klarifikasi (opsional)').fill('Petugas meminta pemeriksaan tandon bocor.');
 await page.getByRole('button',{name:'Simpan draf di perangkat'}).click();
 await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
 const note=await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('sigap-offline-reports',2);r.onsuccess=()=>resolve(r.result);});
  return new Promise<string|undefined>(resolve=>{const tx=db.transaction('reports','readonly'),r=tx.objectStore('reports').getAll();tx.oncomplete=()=>{db.close();resolve(r.result[0]?.correction?.payload?.changes?.note);};});
 });
 expect(note).toBe('Petugas meminta pemeriksaan tandon bocor.');
});

test('form klarifikasi dapat dibuka dan angka disimpan setelah benar-benar offline',async({page,context})=>{
 await page.goto('/offline');
 await expect(page.getByRole('status')).toContainText('Antarmuka tersedia',{timeout:15000});
 await context.setOffline(true);await page.reload();
 await page.getByRole('button',{name:'Buat laporan lewat formulir'}).click();
 await page.getByLabel('Nama posko',{exact:true}).fill('Posko Tanpa Jaringan');
 await page.getByLabel('Desa',{exact:true}).fill('Desa Uji');
 await page.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('15');
 await page.getByRole('spinbutton',{name:'Laki-laki',exact:true}).fill('7');
 await page.getByRole('spinbutton',{name:'Perempuan',exact:true}).fill('8');
 await page.getByRole('button',{name:'Simpan draf di perangkat'}).click();
 await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
 await page.reload();
 await expect(page.locator('.offline-report-text')).toContainText('jumlah jiwa: 15');
});

test('koreksi angka, stok nol dan periode 48 jam bertahan tanpa mengubah salinan asal',async({page,context})=>{
 let posts=0;page.on('request',r=>{if(r.method()==='POST')posts++;});
 await page.goto('/offline');await expect(page.getByRole('status')).toContainText('Antarmuka tersedia');
 await cachedExample(page);await context.setOffline(true);await page.reload();
 await page.getByRole('button',{name:'Klarifikasi Posko Offline · Desa Uji'}).click();
 await page.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('22');
 await page.getByRole('spinbutton',{name:'Laki-laki',exact:true}).fill('10');
 await page.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Kebutuhan & stok',exact:true}).click();
 await page.getByLabel('Kebutuhan yang dilaporkan',{exact:true}).fill('Air bersih');
 await page.getByLabel('Stok air bersih',{exact:true}).fill('0');
 await page.getByLabel('Waktu stok air bersih',{exact:true}).fill('2026-11-10T09:30');
 await page.getByLabel('Periode stok air bersih (jam)',{exact:true}).fill('48');
 await page.getByRole('button',{name:'Simpan draf di perangkat'}).click();
 await expect(page.getByText('1 laporan di perangkat')).toBeVisible();await page.reload();
 const saved=await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('sigap-offline-reports',2);r.onsuccess=()=>resolve(r.result);});
  return new Promise<any>(resolve=>{const tx=db.transaction(['reports','shelters'],'readonly'),reports=tx.objectStore('reports').getAll(),copies=tx.objectStore('shelters').getAll();tx.oncomplete=()=>{db.close();resolve({report:reports.result[0],copy:copies.result[0]});};});
 });
 expect(saved.report.correction).toMatchObject({owner:'owner-test',contextId:'context-test',payload:{base_key:'original-key',changes:{people:22,male:10,needs:['Air bersih'],stock:{air_liter_per_hari:0},stockContext:{air_liter_per_hari:{unit:'L',recorded_at:'2026-11-10 09:30',horizon_hours:48}}}}});
 expect(saved.copy.rows[0].people).toBe(20);expect(posts).toBe(0);
});

test('gagal menulis formulir tidak menghapus isian dan percobaan ulang tetap satu laporan',async({page,context})=>{
 await page.goto('/offline');await expect(page.getByRole('status')).toContainText('Antarmuka tersedia');await context.setOffline(true);
 await page.evaluate(()=>{const original=IDBObjectStore.prototype.add;let failed=false;IDBObjectStore.prototype.add=function(...args:Parameters<typeof original>){if(!failed){failed=true;throw new DOMException('Penyimpanan penuh.','QuotaExceededError');}return original.apply(this,args);};});
 await page.getByRole('button',{name:'Buat laporan lewat formulir'}).click();
 await page.getByLabel('Nama posko',{exact:true}).fill('Posko Jangan Hilang');await page.getByLabel('Desa',{exact:true}).fill('Desa Uji');
 await page.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('12');
 await page.getByRole('button',{name:'Simpan draf di perangkat'}).click();
 await expect(page.getByRole('alert')).toContainText('Penyimpanan penuh');
 await expect(page.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true})).toHaveValue('12');
 await page.getByRole('button',{name:'Simpan draf di perangkat'}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
});
