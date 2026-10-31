import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/spherePlanning.json',import.meta.url),'utf8'));
async function workspace(page:Page,detailed=true){
 let seq=0;const events:{id:number;body:string}[]=[];
 const emit=(type:string,data:unknown)=>{const id=++seq;events.push({id,body:`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`});};
 await page.emulateMedia({reducedMotion:'reduce'});await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
 emit('stored_rekap_ready',{records:[fixture.record]});
 const calculation=structuredClone(fixture.calculation);if(!detailed)delete calculation.planning;
 emit('calculation_ready',{shelters:[calculation]});
 await page.goto('/?view=Laporan');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();
 if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 await page.getByText('Rincian jiwa & perkiraan kebutuhan',{exact:true}).click();return emit;
}
test('all reported groups, population macros and age allocations appear with their Sphere limits',async({page})=>{
 await workspace(page);const preview=page.getByRole('region',{name:'Pratinjau rekap',exact:true});
 for(const [label,n] of [['Balita (0–4 tahun)','10'],['Anak (5–17 tahun)','20'],['Ibu hamil','3'],['Ibu menyusui','4']])await expect(preview.locator('.population-details > div').filter({has:page.getByText(label,{exact:true})})).toContainText(n);
 const sphere=preview.getByRole('region',{name:'Rincian kebutuhan Sphere'});
 await expect(sphere.locator('.sphere-macro-grid')).toContainText('5.300 g/hari');await expect(sphere.locator('.sphere-macro-grid')).toContainText('4.000 g/hari');await expect(sphere.locator('.sphere-macro-grid')).toContainText('38.200 g/hari');
 const adults=sphere.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Dewasa (sisa total)',exact:true})});await expect(adults).toContainText('65');await expect(adults).toContainText('975');await expect(adults).toContainText('136.500');
 await expect(sphere).toContainText('bukan kebutuhan gizi khusus usia');await expect(sphere).toContainText('bukan target tersendiri dari Sphere');
 await preview.getByRole('button',{name:'Periksa & klarifikasi Posko Anggrek',exact:true}).click();
 const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});await expect(dialog.locator('.population-details')).toContainText('Ibu menyusui');await dialog.getByRole('group',{name:'Bagian data pembanding'}).getByRole('button',{name:'Perhitungan',exact:true}).click();await expect(dialog.getByRole('region',{name:'Rincian kebutuhan Sphere'})).toContainText('38.200 g/hari');
 await page.screenshot({path:test.info().outputPath('sphere-detail.png'),fullPage:true});
 for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
test('legacy calculations offer a read-only recalculation instead of guessing nutrients',async({page})=>{
 await workspace(page,false);const sphere=page.getByRole('region',{name:'Pratinjau rekap',exact:true}).getByRole('region',{name:'Rincian kebutuhan Sphere'});
 await expect(sphere).toContainText('Rincian makro dan kelompok usia belum dihitung');await expect(sphere.locator('.sphere-macro-grid')).toHaveCount(0);
 let request:any,writes=0;page.on('request',r=>{if(r.url().endsWith('/decisions'))writes++;});await page.route('**/api/sessions/*/messages',r=>{request=r.request().postDataJSON();return r.fulfill({status:409,json:{error:{message:'Proses sebelumnya belum selesai.'}}});});
 await sphere.getByRole('button',{name:'Hitung kebutuhan rinci'}).click();await expect.poll(()=>request?.text).toContain('kebutuhan seluruh posko');expect(writes).toBe(0);
});
