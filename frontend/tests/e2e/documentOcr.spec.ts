import {test,expect,composer,sendButton} from './fixtures';
import {readFile} from 'node:fs/promises';

const fixture=new URL('../../../data/synthetic/ocr/laporan-posko.png',import.meta.url);
const result={text:'Posko Harapan\nDesa Sukamaju\nJumlah jiwa: 100\nLaki-laki: 40\nPerempuan: 60',filename:'laporan-posko.png',pages:1,engine:'tesseract',source_sha256:'a'.repeat(64),warnings:['Hasil OCR belum diverifikasi. Periksa ulang angka, nama posko/desa, dan susunan tabel sebelum mengirim.']};
const review=(page:import('@playwright/test').Page)=>page.getByRole('region',{name:'Tinjau hasil OCR',exact:true});
async function upload(page:import('@playwright/test').Page,name='laporan-posko.png'){
 await page.locator('input[type=file]').setInputFiles({name,mimeType:name.endsWith('.pdf')?'application/pdf':'image/png',buffer:await readFile(name.endsWith('.pdf')?new URL('../../../data/synthetic/ocr/laporan-dua-halaman.pdf',import.meta.url):fixture)});
}

test('document OCR is reviewed and editable before loading or explicitly sending any text to the agent',async({app},testInfo)=>{
 let uploads=0,messages=0;let sent:any;
 await app.route('**/api/sessions/*/documents/extract',async route=>{uploads++;expect(route.request().headers()['content-type']).toBe('application/octet-stream');expect(decodeURIComponent(route.request().headers()['x-document-name'])).toBe('laporan-posko.png');expect(route.request().postDataBuffer()!.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));await route.fulfill({json:result});});
 await app.route('**/api/sessions/*/messages',route=>{messages++;sent=route.request().postDataJSON();return route.fulfill({status:202,json:{batch_id:'ocr-review',pii_summary:{totalRedacted:0}}});});
 await upload(app);await expect(review(app)).toBeVisible();await expect(review(app).getByRole('img',{name:'Dokumen asli untuk dibandingkan dengan hasil OCR'})).toBeVisible();await expect(review(app)).toContainText('belum dikirim ke Agent');await expect(composer(app)).toHaveValue('');expect(messages).toBe(0);expect(uploads).toBe(1);
 const corrected=result.text.replace('100','101');await review(app).getByLabel('Teks hasil OCR').fill(corrected);
 await app.getByRole('button',{name:'Rekap',exact:true}).click();await app.getByRole('button',{name:'Laporan',exact:true}).click();await expect(review(app).getByLabel('Teks hasil OCR')).toHaveValue(corrected);expect(uploads).toBe(1);expect(messages).toBe(0);
 await app.screenshot({path:testInfo.outputPath('review-ocr.png'),fullPage:true});
 await review(app).getByRole('button',{name:'Gunakan teks ini',exact:true}).click();await expect(review(app)).toHaveCount(0);await expect(composer(app)).toHaveValue(corrected);expect(messages).toBe(0);
 await sendButton(app).click();await expect.poll(()=>messages).toBe(1);expect(sent.text).toBe(corrected);expect(sent.filename).toBe('laporan-posko.png.ocr.txt');
});
test('OCR does not overwrite a draft typed during reading; cancel and append are explicit',async({app})=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await app.route('**/api/sessions/*/documents/extract',async route=>{await held;await route.fulfill({json:result});});
 try{
  await composer(app).fill('Draf awal.');await upload(app);await expect(app.getByRole('region',{name:'Pembacaan dokumen',exact:true})).toBeVisible();await expect(sendButton(app)).toBeDisabled();await expect(app.getByRole('button',{name:'Unggah berkas',exact:true})).toBeDisabled();
  await composer(app).fill('Draf yang ditambah selama menunggu.');release();await expect(review(app)).toBeVisible();await expect(composer(app)).toHaveValue('Draf yang ditambah selama menunggu.');
  await review(app).getByRole('button',{name:'Tambahkan ke laporan'}).click();await expect(composer(app)).toHaveValue('Draf yang ditambah selama menunggu.\n\n'+result.text);
  await upload(app);await expect(review(app)).toBeVisible();await review(app).getByRole('button',{name:'Batalkan OCR'}).click();await expect(composer(app)).toHaveValue('Draf yang ditambah selama menunggu.\n\n'+result.text);
 }finally{release();}
});
test('oversized documents, parser failures and empty OCR preserve existing text with actionable errors',async({app})=>{
 let calls=0;
 await app.route('**/api/sessions/*/documents/extract',route=>{calls++;return route.fulfill({status:422,json:{error:{code:'OCR_NO_TEXT',message:'Tidak ditemukan teks yang terbaca. Gunakan foto lebih jelas.'}}});});
 await composer(app).fill('Laporan tetap ada.');
 await app.locator('input[type=file]').setInputFiles({name:'besar.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(5*1024*1024+1)});
 await expect(app.getByRole('alert')).toContainText('maksimal 5 MiB');expect(calls).toBe(0);
 await upload(app);await expect(app.getByRole('alert')).toContainText('Tidak ditemukan teks');await expect(composer(app)).toHaveValue('Laporan tetap ada.');await expect(review(app)).toHaveCount(0);await expect(sendButton(app)).toBeEnabled();expect(calls).toBe(1);
});
test('cancelling an active OCR request unlocks input and ignores a late response',async({app})=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let finished=false;
 await app.route('**/api/sessions/*/documents/extract',async route=>{await held;try{await route.fulfill({json:result});}finally{finished=true;}});
 try{
  await composer(app).fill('Draf yang tidak boleh tertimpa.');await upload(app);await app.getByRole('button',{name:'Batalkan pembacaan',exact:true}).click();
  await expect(app.getByRole('button',{name:'Unggah berkas',exact:true})).toBeEnabled();release();await expect.poll(()=>finished).toBe(true);
  await expect(review(app)).toHaveCount(0);await expect(composer(app)).toHaveValue('Draf yang tidak boleh tertimpa.');await expect(sendButton(app)).toBeEnabled();
 }finally{release();}
});
test('PDF metadata is shown and OCR cannot accidentally append prose to an active CSV import',async({app})=>{
 await app.route('**/api/sessions/*/documents/extract',route=>route.fulfill({json:{...result,filename:'scan.pdf',pages:2}}));
 await app.locator('input[type=file]').setInputFiles({name:'rekap.csv',mimeType:'text/csv',buffer:Buffer.from('posko,desa,jumlah_jiwa\nPosko Uji,Desa Uji,10')});
 await upload(app,'scan.pdf');await expect(review(app)).toContainText('scan.pdf · 2 halaman');await review(app).getByRole('combobox',{name:'Halaman dokumen'}).selectOption('2');await expect(review(app).locator('object')).toHaveAttribute('data',/#page=2$/);await expect(review(app).getByLabel('Teks hasil OCR')).toHaveValue(result.text);await review(app).getByRole('button',{name:'Tambahkan ke laporan'}).click();await expect(app.getByRole('alert')).toContainText('CSV masih aktif');
 await expect(composer(app)).toHaveValue('posko,desa,jumlah_jiwa\nPosko Uji,Desa Uji,10');
 await app.getByRole('button',{name:'Bersihkan',exact:true}).click();await review(app).getByRole('button',{name:'Gunakan teks ini'}).click();await expect(composer(app)).toHaveValue(result.text);
 expect(await app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('pasted image enters OCR review without sending or replacing a draft',async({app})=>{
 let uploads=0,messages=0;
 await app.route('**/api/sessions/*/documents/extract',async route=>{uploads++;expect(decodeURIComponent(route.request().headers()['x-document-name'])).toBe('clipboard-1.png');await route.fulfill({json:{...result,filename:'clipboard-1.png'}});});
 await app.route('**/api/sessions/*/messages',route=>{messages++;return route.fulfill({status:202,json:{}});});
 await composer(app).fill('Draf tetap ada.');
 await composer(app).evaluate((element)=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])],'image.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await expect(review(app)).toBeVisible();await expect(composer(app)).toHaveValue('Draf tetap ada.');expect(uploads).toBe(1);expect(messages).toBe(0);
});
