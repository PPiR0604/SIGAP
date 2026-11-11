import {test,expect} from '@playwright/test';

test('sesi backend gagal tidak menghapus isian atau mengaku menerima laporan',async({page})=>{
  await page.route('**/api/sessions',route=>route.fulfill({status:503,json:{error:{message:'Sesi belum siap'}}}));
  await page.goto('/');
  await page.getByRole('navigation',{name:'Navigasi utama'}).getByRole('button',{name:'Laporan',exact:true}).click();
  const composer=page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'});
  await composer.fill('Laporan sintetis harus tetap ada');
  await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await expect(composer).toHaveValue('Laporan sintetis harus tetap ada');
  await expect(page.getByRole('alert')).toContainText('Laporan belum dikirim');
  await expect(page.getByText('Pesan diterima di sesi lokal.',{exact:false})).toHaveCount(0);
});

test('klik simpan ganda menghasilkan satu laporan dan perubahan tab lain terlihat',async({page,context})=>{
  await page.goto('/offline');
  const other=await context.newPage();await other.goto('/offline');
  await expect(other.getByText('0 laporan di perangkat')).toBeVisible();
  await page.getByLabel('Catat laporan').fill('Laporan sintetis klik ganda');
  await page.getByRole('button',{name:'Simpan di perangkat'}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
  await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
  await expect(other.getByText('1 laporan di perangkat')).toBeVisible();
  await other.getByRole('button',{name:'Hapus dari perangkat'}).click();
  await other.getByRole('button',{name:'Ya, hapus salinan'}).click();
  await expect(page.getByText('0 laporan di perangkat')).toBeVisible();
});

test('kegagalan penyimpanan mempertahankan teks dan tombol bisa dicoba kembali',async({page})=>{
  await page.addInitScript(()=>{IDBObjectStore.prototype.add=function(){throw new DOMException('Penyimpanan perangkat penuh.','QuotaExceededError');};});
  await page.goto('/offline');
  await page.getByLabel('Catat laporan').fill('Jangan hilangkan laporan sintetis ini');
  await page.getByRole('button',{name:'Simpan di perangkat'}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Catat laporan')).toHaveValue('Jangan hilangkan laporan sintetis ini');
  await expect(page.getByRole('button',{name:'Simpan di perangkat'})).toBeEnabled();
  await expect(page.getByText('0 laporan di perangkat')).toBeVisible();
});

test('laporan antrean disiapkan secara manual tanpa pengiriman otomatis',async({page})=>{
  await page.goto('/offline');
  await page.getByLabel('Catat laporan').fill('Posko Antrean Sintetis 12 jiwa, stok air belum diketahui.');
  await page.getByRole('button',{name:'Simpan di perangkat'}).click();
  await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
  await page.goto('/');
  await page.getByRole('navigation',{name:'Navigasi utama'}).getByRole('button',{name:'Laporan',exact:true}).click();
  await page.getByText('Antrean laporan di perangkat',{exact:true}).first().click();
  let sends=0;page.on('request',r=>{if(r.method()==='POST'&&/\/messages$/.test(r.url()))sends++;});
  await page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'}).fill('Draf lain yang belum dikirim');
  await page.getByRole('button',{name:'Siapkan untuk diproses'}).click();
  await expect(page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'})).toHaveValue('Draf lain yang belum dikirim');
  await expect(page.getByRole('alert')).toContainText('Formulir masih berisi teks');
  await page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'}).clear();
  await page.getByRole('button',{name:'Siapkan untuk diproses'}).click();
  await expect(page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'})).toHaveValue('Posko Antrean Sintetis 12 jiwa, stok air belum diketahui.');
  await expect(page.getByText('Sudah disiapkan · periksa sebelum mengirim ulang')).toBeVisible();
  expect(sends).toBe(0);
  const accepted=page.waitForResponse(r=>r.url().endsWith('/messages')&&r.ok());
  await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await accepted;
  expect(sends).toBe(1);
  await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
});
