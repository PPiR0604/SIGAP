import {test,expect,type Page} from '@playwright/test';

const a={batch_id:'stored-a',report_id:'R001',shelter_name:'Posko Harapan',village:'Sukamaju',total_people:100,male:40,female:60,infants_toddlers:10,elderly:12,pregnant:4,disability:0,urgent_needs:['air bersih','beras']};
const b={...a,batch_id:'stored-b',shelter_name:'Posko Cibening',village:'Cibening',total_people:50,infants_toddlers:5,elderly:8,pregnant:null,urgent_needs:['terpal','obat']};
const rows=(page:Page)=>(page.viewportSize()?.width??1440)<=760?page.locator('.recap-mobile-list > article'):page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr');
async function openCharts(page:Page,empty=false){
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 let id=0;const events:{id:number;body:string}[]=[];
 const emit=(type:string,data:unknown)=>{const next=++id;events.push({id:next,body:`id: ${next}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`});};
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': heartbeat\n\n'}));
 if(!empty){
   emit('stored_rekap_ready',{records:[a,b]});
   emit('calculation_ready',{batch_id:'read',shelters:[
     {shelter_name:a.shelter_name,village:a.village,needs:{air_liter_per_hari:{value:1500}},gaps:{air_liter_per_hari:300}},
     {shelter_name:b.shelter_name,village:b.village,needs:{air_liter_per_hari:{value:750}},gaps:{air_liter_per_hari:0}},
   ]});
 }
 await page.goto('/?view=Laporan');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();
 if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 return emit;
}
test('diagram Sphere dan kelompok rentan mengikuti posko yang dipilih',async({page})=>{
 await openCharts(page);
 await page.getByText('Rincian jiwa & perkiraan kebutuhan',{exact:true}).click();
 const sphere=page.getByRole('region',{name:'Rincian kebutuhan Sphere'});
 await expect(sphere).toContainText('Kekurangan: 300 L/hari');
 await page.getByLabel('Pilih posko pratinjau').selectOption({label:'Posko Cibening · Cibening'});
 await expect(sphere).toContainText('Terpenuhi (kekurangan 0 L/hari)');
 await page.screenshot({path:test.info().outputPath('diagram-laporan.png'),fullPage:true});
});
test('rekap keeps one status pie and category actions without duplicate charts or shelter lists',async({page})=>{
 await openCharts(page);let writes=0;
 page.on('request',r=>{if(r.url().endsWith('/decisions'))writes++;});
 await page.getByRole('button',{name:'Rekap',exact:true}).click();
 const categories=page.getByRole('region',{name:'Kebutuhan yang dilaporkan',exact:true});
 await expect(categories.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Air bersih',exact:true})})).toContainText('1 dari 2');
 await expect(categories.getByRole('columnheader',{name:'Perkiraan kebutuhan',exact:true})).toBeVisible();
 const water=categories.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Air bersih',exact:true})});await expect(water).toContainText('1.500 L/hari');await expect(water).not.toContainText('2.250');
 const status=page.getByRole('region',{name:'Status Pemeriksaan Posko'});
 if((await page.viewportSize())!.width>1024){const [left,right]=await Promise.all([categories.boundingBox(),status.boundingBox()]);expect(Math.abs(left!.width-right!.width)).toBeLessThan(2);expect(Math.abs(left!.height-right!.height)).toBeLessThan(2);}
 const help=status.getByRole('button',{name:'Arti status pemeriksaan'}),helpText=status.locator('.status-help-content');
 await help.focus();await help.press('Enter');await expect(helpText).toBeVisible();await expect(helpText).toContainText('tidak berarti sudah disetujui');await help.press('Escape');await expect(helpText).toBeHidden();
 await expect(status.getByRole('img')).toHaveAttribute('aria-label',/Sebaran status 2 posko/);
 await expect(page.getByRole('region',{name:'Ringkasan Kebutuhan Darurat'})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Pemetaan Kebutuhan per Wilayah'})).toHaveCount(0);
 await page.getByLabel('Filter desa').selectOption('Cibening');
 const table=page.getByRole('region',{name:'Daftar posko',exact:true});await expect(rows(page)).toHaveCount(1);
 const detail=table.getByRole('button',{name:'Posko Cibening',exact:true});await detail.focus();await detail.press('Enter');
 await expect(page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true}).getByRole('heading',{name:'Posko Cibening',exact:true})).toBeVisible();await page.getByRole('button',{name:'Kembali',exact:true}).click();
 expect(writes).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('diagram-rekap.png'),fullPage:true});
});
test('diagram tetap terlihat saat data kosong dan diperbarui saat koreksi diterima',async({page})=>{
 const emit=await openCharts(page,true);
 await expect(page.getByText('Analisis kebutuhan dan kelompok rentan',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Rekap',exact:true}).click();
 await expect(page.getByRole('region',{name:'Kebutuhan yang dilaporkan',exact:true})).toContainText('Belum ada posko dalam rekap.');
 emit('stored_rekap_ready',{records:[a,b]});
 await page.getByRole('button',{name:'Laporan',exact:true}).click();
 await page.getByText('Rincian jiwa & perkiraan kebutuhan',{exact:true}).click();
 await expect(page.locator('.population-details')).toContainText('100');
 emit('preview_ready',{batch_id:'c'.repeat(32),snapshot_id:'d'.repeat(32),records:[{...a,batch_id:'corrected',total_people:120,infants_toddlers:0,update_target:{batch_id:a.batch_id,report_id:a.report_id}}]});
 await expect(page.locator('.population-details')).toContainText('120');
 emit('calculation_ready',{batch_id:'c'.repeat(32),shelters:[{shelter_name:a.shelter_name,village:a.village,needs:{air_liter_per_hari:{value:1800}},gaps:{air_liter_per_hari:300}}]});
 const sphere=page.getByRole('region',{name:'Rincian kebutuhan Sphere'});
 await expect(sphere).toContainText('1.800 L/hari');
 await expect(sphere).toContainText('Kekurangan: 300 L/hari');
 await page.getByRole('button',{name:'Rekap',exact:true}).click();
 await expect(rows(page)).toHaveCount(2);
 await expect(page.getByRole('region',{name:'Kebutuhan yang dilaporkan',exact:true}).getByRole('row').filter({has:page.getByRole('rowheader',{name:'Medis',exact:true})})).toContainText('1 dari 2');
});

test('status action uses the single main table, retaining pagination and live updates',async({page})=>{
 const emit=await openCharts(page,true);const records=Array.from({length:12},(_,i)=>({...a,batch_id:`partial-${i}`,report_id:`R${i+1}`,shelter_name:`Posko Parsial ${i+1}`,total_people:null,male:null,female:null}));
 emit('stored_rekap_ready',{records});await page.getByRole('button',{name:'Rekap',exact:true}).click();
 await page.getByRole('button',{name:'12 posko perlu diperiksa. Periksa',exact:true}).click();await expect(page.getByLabel('Filter status')).toHaveValue('Perlu pemeriksaan');
 const table=page.getByRole('region',{name:'Daftar posko',exact:true});await expect(rows(page)).toHaveCount(10);
 await page.getByRole('button',{name:'Berikutnya',exact:true}).click();await expect(rows(page)).toHaveCount(2);await expect(table).toContainText('Posko Parsial 12');
 emit('stored_rekap_ready',{records:records.slice(0,2)});await expect(rows(page)).toHaveCount(2);await expect(table).toContainText('Posko Parsial 1');await expect(page.getByRole('button',{name:'Berikutnya',exact:true})).toBeDisabled();
 await expect(page.getByRole('list',{name:'Daftar posko berdasarkan status'})).toHaveCount(0);
});

test('status pie and its keyboard legend filter the same main table and respond to live updates',async({page},info)=>{
 const emit=await openCharts(page,true);
 const partial={...a,batch_id:'partial',report_id:'R002',shelter_name:'Posko Parsial',total_people:null,male:null,female:null};
 const clarification={...a,batch_id:'clarify',report_id:'R003',shelter_name:'Posko Klarifikasi',total_people:101};
 const waiting={...a,batch_id:'waiting',report_id:'R004',shelter_name:'Posko Persetujuan',storage_conflicts:[{field:'male',stored_value:41,incoming_value:40}]};
 await page.getByRole('button',{name:'Rekap',exact:true}).click();
 const chart=page.getByRole('region',{name:'Status Pemeriksaan Posko'}),table=page.getByRole('region',{name:'Daftar posko',exact:true});
 await expect(chart.getByRole('img')).toHaveAttribute('aria-label','Belum ada data status posko');await expect(chart.locator('.status-pie-slice')).toHaveCount(0);
 emit('stored_rekap_ready',{records:[a,partial,clarification,waiting]});
 await expect(chart.locator('.status-pie-slice')).toHaveCount(3);
 for(const label of ['Perlu klarifikasi','Data belum lengkap'])await expect(chart.getByRole('button',{name:`${label}: 1 posko`,exact:true})).toContainText('25%');await expect(chart.getByRole('button',{name:'Siap diperiksa: 2 posko',exact:true})).toContainText('50%');
 const ready=chart.getByRole('button',{name:'Siap diperiksa: 2 posko',exact:true});await ready.focus();await ready.press('Enter');await expect(page.getByLabel('Filter status')).toHaveValue('Siap ditinjau');await expect(rows(page)).toHaveCount(2);await expect(table).toContainText('Posko Harapan');await expect(ready).toHaveAttribute('aria-pressed','true');
 await ready.click();await expect(rows(page)).toHaveCount(4);await expect(page.getByLabel('Filter status')).toHaveValue('Semua status');
 await chart.locator('path.status-pie-slice').first().click();await expect(page.getByLabel('Filter status')).toHaveValue('Perlu klarifikasi');await expect(table).toContainText('Posko Klarifikasi');await expect(rows(page)).toHaveCount(1);
 await page.getByLabel('Filter status').selectOption('Semua status');emit('stored_rekap_ready',{records:[a]});await expect(chart.locator('circle.status-pie-slice')).toHaveCount(1);await expect(chart.getByRole('button',{name:'Siap diperiksa: 1 posko',exact:true})).toContainText('100%');
 await chart.getByRole('button',{name:'Data belum lengkap: 0 posko',exact:true}).click();await expect(rows(page)).toHaveCount(0);await page.getByRole('button',{name:'Reset filter',exact:true}).click();await expect(rows(page)).toHaveCount(1);
 await expect(page.getByRole('list',{name:'Daftar posko berdasarkan status'})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await chart.screenshot({path:info.outputPath('status-pie.png')});
});
