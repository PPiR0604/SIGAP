import {test,expect,type Page} from '@playwright/test';
const a={batch_id:'stored-a',report_id:'R001',shelter_name:'Posko Anggrek',village:'Sukajaya',total_people:100,male:45,female:55,urgent_needs:['air bersih'],total_families:20};
const b={...a,batch_id:'stored-b',report_id:'R002',shelter_name:'Posko Melati',village:'Mekarsari',total_people:null,male:null,female:null,missing_fields:['total_people'],is_estimate:true};
async function workspace(page:Page){
 let seq=0;const events:{id:number;body:string}[]=[];
 const emit=(event:string,data:unknown)=>{const id=++seq;events.push({id,body:`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`});};
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
 emit('stored_rekap_ready',{records:[a,b]});await page.goto('/?view=Laporan');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();return emit;
}

test('report results explain the difference and lead to the exact shelter without saving',async({page})=>{
 const emit=await workspace(page);let writes=0;page.on('request',r=>{if(r.url().endsWith('/decisions'))writes++;});
 emit('preview_ready',{batch_id:'c'.repeat(32),snapshot_id:'d'.repeat(32),records:[{...a,total_people:98,update_target:{batch_id:a.batch_id,report_id:a.report_id}}]});
 if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:'Lihat hasil pemeriksaan',exact:true}).click();
 const result=page.getByRole('region',{name:'Hasil pemeriksaan Posko Anggrek',exact:true});
 await expect(result).toContainText('Rincian berbeda 2 jiwa');await expect(result).toContainText('45 laki-laki + 55 perempuan = 100; total laporan 98.');
 const row=result.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Jumlah jiwa',exact:true})});await expect(row).toContainText('100');await expect(row).toContainText('98');
 await expect(result).toContainText('Langkah berikutnya');await expect(result).toContainText('Menunggu persetujuan');
 await page.screenshot({path:test.info().outputPath('laporan-hasil.png'),fullPage:true});
 await result.getByRole('button',{name:'Periksa & klarifikasi Posko Anggrek',exact:true}).click();await expect(page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true})).toContainText('Posko Anggrek');expect(writes).toBe(0);
});

test('bulletin reading follows its own source and shows limits before publication actions',async({page})=>{
 const emit=await workspace(page);emit('bulletin_ready',{batch_id:'bulletin-1',content:'# Draf bantuan\n\n100 jiwa terdata. Jumlah jiwa Posko Melati belum dilaporkan.',source_metadata:{snapshot_id:'source-v1',records:[a,b],generated_at:'2026-10-29T01:00:00Z',kind:'stored',context_name:'Pos Komando Latihan'}});
 await page.getByRole('button',{name:'Buletin',exact:true}).click();const source=page.getByRole('region',{name:'Sumber dan cakupan buletin'});
 await expect(source.getByRole('heading',{name:'Pos Komando Latihan'})).toBeVisible();await expect(source).toContainText('100 jiwa terdata · 1 posko belum melaporkan jumlah jiwa');await expect(source).toContainText('1 posko memakai estimasi');
 await expect(page.getByRole('list',{name:'Alur buletin'})).toContainText('Perlu tinjauan admin');await expect(page.getByText('Publikasi oleh admin',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Tinjau publikasi',exact:true})).toHaveCount(0);
 emit('preview_ready',{batch_id:'e'.repeat(32),snapshot_id:'f'.repeat(32),records:[{...a,total_people:120,male:60,female:60,update_target:{batch_id:a.batch_id,report_id:a.report_id}}]});
 await expect(page.getByText('Data sumber berubah; susun ulang untuk memakai data terbaru.',{exact:true})).toBeVisible();await expect(source).toContainText('100 jiwa terdata');await expect(source).not.toContainText('120 jiwa');
 await page.getByRole('button',{name:'Lihat aksi pembaruan'}).click();await expect(page.getByRole('heading',{name:'Tindakan berikutnya'})).toBeFocused();await expect(page.getByRole('button',{name:'Susun ulang draf',exact:true})).toHaveCount(1);
 const originalSize=page.viewportSize()!;for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize(originalSize);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:test.info().outputPath('buletin-alur.png'),fullPage:true});
});

test('legacy bulletin never substitutes workspace totals or an invented operation name',async({page})=>{
 const emit=await workspace(page);emit('bulletin_ready',{batch_id:'legacy',content:'# Draf lama\n\nPeriksa sumber sebelum digunakan.'});await page.getByRole('button',{name:'Buletin',exact:true}).click();
 const source=page.getByRole('region',{name:'Sumber dan cakupan buletin'});await expect(source).toContainText('Referensi sumber draf belum tersedia.');await expect(source).not.toContainText('100 jiwa');
 await source.getByText('Rincian sumber dan versi',{exact:true}).click();await expect(source).toContainText('Nama operasi belum tersedia');await expect(page.getByRole('article',{name:'Isi draf buletin'})).toContainText('Draf lama');
});
