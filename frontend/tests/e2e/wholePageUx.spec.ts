import {test,expect,createPreview,composer,sendButton} from './fixtures';

test('failed sends keep the draft and persistent feedback until dismissed',async({app})=>{
 await app.route('**/api/sessions/*/messages',r=>r.fulfill({status:503,json:{error:{message:'Layanan belum tersedia. Coba lagi sebentar.'}}}));
 await composer(app).fill('Laporan yang perlu dikirim ulang');await sendButton(app).click();
 const error=app.getByRole('alert');await expect(error).toContainText('Layanan belum tersedia');
 await app.clock.install();await app.clock.fastForward(6000);
 await expect(error).toBeVisible();await expect(composer(app)).toHaveValue('Laporan yang perlu dikirim ulang');await expect(sendButton(app)).toBeEnabled();
 await app.getByRole('button',{name:'Tutup pesan gagal'}).click();await expect(error).toHaveCount(0);
});
test('reports focus on the current task while diagrams remain discoverable in recap and disclosure',async({app})=>{
 await createPreview(app);await app.getByRole('button',{name:'Laporan',exact:true}).click();
 await expect(app.getByRole('heading',{level:1})).toBeFocused();
 await expect(app.getByRole('region',{name:'Status Pemeriksaan Posko'})).toHaveCount(0);
 if((app.viewportSize()?.width??1440)<=760)await app.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 const summary=app.getByText('Rincian jiwa & perkiraan kebutuhan');
 await summary.focus();await summary.press('Enter');await expect(app.getByRole('region',{name:'Rincian kebutuhan Sphere'})).toBeVisible();
 await app.getByRole('button',{name:'Buka rekap posko'}).click();await expect(app.getByRole('heading',{name:'Rekap posko',exact:true})).toBeFocused();await expect(app.getByRole('region',{name:'Kebutuhan yang dilaporkan',exact:true})).toBeVisible();await expect(app.getByRole('region',{name:'Status Pemeriksaan Posko'})).toBeVisible();await expect(app.getByRole('region',{name:'Ringkasan Kebutuhan Darurat'})).toHaveCount(0);
});
test('village and needs have explicit fields; ignored changes preserve drafts without saving',async({app})=>{
 await createPreview(app);let writes=0;app.on('request',r=>{if(r.url().endsWith('/decisions'))writes++;});
 await app.getByRole('button',{name:'Posko Harapan',exact:true}).click();const dialog=app.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});
 await dialog.getByLabel('Desa',{exact:true}).fill('Desa Uji Baru');await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Kebutuhan & stok',exact:true}).click();await dialog.getByLabel('Kebutuhan yang dilaporkan',{exact:true}).fill('sabun\nselimut');
 const request=app.waitForRequest('**/api/sessions/*/messages');await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
 const payload=(await request).postDataJSON();expect(payload.text).toContain('ubah desa posko ini menjadi "Desa Uji Baru"');expect(payload.text).toContain('sabun; selimut');
 await expect(dialog.getByRole('alert')).toContainText('belum menerapkan seluruh data');await expect(dialog.getByLabel('Desa',{exact:true})).toHaveValue('Desa Uji Baru');await expect(dialog.getByLabel('Kebutuhan yang dilaporkan',{exact:true})).toHaveValue('sabun\nselimut');expect(writes).toBe(0);
});
test('empty bulletin has one clear compose action and cannot copy or print placeholder text',async({app})=>{
 await app.getByRole('button',{name:'Buletin',exact:true}).click();
 await expect(app.getByRole('button',{name:'Susun draf',exact:true})).toHaveCount(1);await expect(app.getByRole('button',{name:'Salin draf',exact:true})).toHaveCount(0);await expect(app.getByRole('button',{name:'Cetak draf',exact:true})).toBeDisabled();await expect(app.getByRole('article',{name:'Isi draf buletin'})).toHaveCount(0);
 await expect(app.getByText('Rincian sumber dan versi',{exact:true})).toBeVisible();await expect(app.getByText('Referensi versi rekap',{exact:true})).toBeHidden();
 expect(await app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
