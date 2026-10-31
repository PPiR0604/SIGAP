// Production-built UI + disposable in-memory backend + real native OCR. No production API writes.
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
const api='http://127.0.0.1:8798';
for(let i=0;i<30;i++){try{const response=await fetch(api+'/api/health');if(response.ok)break;}catch{}if(i===29)throw new Error('Disposable OCR server did not start');await new Promise(resolve=>setTimeout(resolve,500));}
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});let messages=0,uploads=0;
 await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/events')){await route.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'});return;}
  if(path.endsWith('/messages')){messages++;await route.abort();return;}
  if(path.endsWith('/documents/extract'))uploads++;
  const response=await route.fetch({url:api+path});await route.fulfill({response});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:5173/');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();
 const input=page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'}),review=page.getByRole('region',{name:'Tinjau hasil OCR',exact:true});
 const fixtures=new URL('../../../data/synthetic/ocr/',import.meta.url);
 await input.fill('Catatan tambahan petugas.');
 await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('laporan-posko.png',fixtures)));
 await expect(review).toBeVisible({timeout:30000});await expect(review.getByLabel('Teks hasil OCR')).toHaveValue(/Jumlah jiwa:\s*100/);await expect(input).toHaveValue('Catatan tambahan petugas.');
 const output=new URL('../../test-results/live-ocr/',import.meta.url);await mkdir(output,{recursive:true});await review.screenshot({path:fileURLToPath(new URL('ocr-nyata.png',output))});
 await review.getByRole('button',{name:'Tambahkan ke laporan'}).click();await expect(input).toHaveValue(/Catatan tambahan petugas\.[\s\S]*Posko Harapan/);
 await page.getByRole('button',{name:'Bersihkan',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('laporan-dua-halaman.pdf',fixtures)));
 await expect(review).toBeVisible({timeout:30000});await expect(review).toContainText('2 halaman');await expect(review.getByLabel('Teks hasil OCR')).toHaveValue(/Posko Harapan[\s\S]*Posko Melati/);
 expect(messages).toBe(0);expect(uploads).toBe(2);expect(errors).toEqual([]);
 console.log('PASS Docker UI -> disposable binary upload endpoint -> native PNG and two-page PDF OCR -> editable review -> append, without production API requests or model sends.');
}finally{await browser.close();}
