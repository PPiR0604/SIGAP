import {test,expect,type Page} from '@playwright/test';
const record={batch_id:'stored-a',report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:100,male:45,female:55,urgent_needs:['air bersih']};
const calculation={scope:'all_shelters',snapshot_refs:[],shelters:[{...record,needs:{air_liter_per_hari:{value:1500},kkal_per_hari:{value:210000},jamban_unit:{value:5},ruang_hunian_m2:{value:350}}}]};
async function setup(page:Page){
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 await page.route('**/api/sessions/*/recovery',r=>r.fulfill({json:{records:[record],reviews:[],after_event_id:0,active_batch:null}}));
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'}));
}
async function summary(page:Page){
 await page.getByRole('navigation').getByRole('button',{name:'Laporan',exact:true}).click();
 if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 const panel=page.getByRole('region',{name:'Ringkasan seluruh posko'});await panel.getByRole('button',{name:'Buka total kebutuhan',exact:true}).click();return panel;
}
test('first access fetches records and all four totals once without adding a chat message',async({page},info)=>{
 await setup(page);let loads=0,messages=0,recoveries=0;
 page.on('request',r=>{if(r.url().endsWith('/messages'))messages++;if(r.url().endsWith('/recovery'))recoveries++;});
 await page.route('**/api/sessions/*/overview',r=>{loads++;return r.fulfill({json:{status:'ready',records:[record],calculation}});});
 await page.goto('/');await expect(page.getByRole('heading',{name:'Tugas petugas',exact:true})).toBeVisible();
 const panel=await summary(page);await expect(panel).toContainText('100 jiwa terdata');
 const needs=panel.getByRole('group',{name:'Kebutuhan seluruh posko'});
 await expect(needs.getByRole('img')).toHaveCount(4);await expect(needs.getByRole('combobox')).toHaveCount(0);
 for(const value of ['1.500 L/hari','210.000 kkal/hari','5 unit','350 m²'])await expect(needs).toContainText(value);
 await expect(needs.locator('.histogram-posko-key')).toHaveCount(0);
 for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await panel.screenshot({path:info.outputPath('all-needs-totals.png')});
 await page.getByRole('navigation').getByRole('button',{name:'Rekap',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'Laporan',exact:true}).click();
 expect(loads).toBe(1);expect(recoveries).toBe(1);expect(messages).toBe(0);await expect(page.getByRole('log',{includeHidden:true}).locator('.operator-bubble-row')).toHaveCount(0);
});
test('failed initial calculation leaves records visible and offers a bounded explicit retry',async({page})=>{
 await setup(page);let loads=0;
 await page.route('**/api/sessions/*/overview',r=>{loads++;return r.fulfill({json:loads===1?{status:'partial',records:[record],calculation:null}:{status:'ready',records:[record],calculation}});});
 await page.goto('/');await expect(page.getByRole('button',{name:'Muat ulang data',exact:true})).toBeVisible();
 const panel=await summary(page);await expect(panel).toContainText('100 jiwa terdata');await expect(panel.getByRole('group',{name:'Kebutuhan seluruh posko'}).getByRole('img')).toHaveCount(0);
 await page.getByRole('button',{name:'Muat ulang data',exact:true}).click();await expect(panel.getByRole('group',{name:'Kebutuhan seluruh posko'}).getByRole('img')).toHaveCount(4);
 await expect(page.getByRole('button',{name:'Muat ulang data',exact:true})).toHaveCount(0);expect(loads).toBe(2);
});
test('a late initial overview cannot replace a newer correction or clear the chat draft',async({page})=>{
 await setup(page);let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
 await page.route('**/api/sessions/*/overview',async r=>{await wait;await r.fulfill({json:{status:'ready',records:[record],calculation}}).catch(()=>{});});
 let seq=0;const events:string[]=[];
 await page.route('**/api/sessions/*/events',r=>{const after=Number(r.request().headers()['last-event-id']||0);return r.fulfill({contentType:'text/event-stream',body:events.slice(after).join('')||': keepalive\n\n'});});
 const emit=(type:string,data:unknown)=>{events.push(`id: ${++seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
 await page.route('**/api/sessions/*/messages',r=>{emit('preview_ready',{batch_id:'b'.repeat(32),snapshot_id:'c'.repeat(32),records:[{...record,total_people:120,male:55,female:65,update_target:{batch_id:record.batch_id,report_id:record.report_id}}]});emit('processing_completed',{batch_id:'b'.repeat(32)});return r.fulfill({status:202,json:{batch_id:'b'.repeat(32),status:'accepted'}});});
 try{
  await page.goto('/?view=Laporan');await expect(page.getByText('Memuat kebutuhan…',{exact:true})).toBeVisible();
  const input=page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'});await input.fill('Koreksi Posko A menjadi 120 jiwa');await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await input.fill('Draf berikutnya');
  if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
  const panel=page.getByRole('region',{name:'Ringkasan seluruh posko'});await expect(panel).toContainText('120 jiwa terdata');release();
  await expect(panel).not.toContainText('100 jiwa terdata');await expect(page.getByLabel('Laporan atau pertanyaan Anda')).toHaveValue('Draf berikutnya');
 }finally{release();}
});

test('an initial recovery failure can be retried without reloading the page or losing typed input',async({page})=>{
 await setup(page);let recovery=0;
 await page.route('**/api/sessions/*/recovery',r=>{recovery++;return r.fulfill(recovery===1?{status:503,json:{error:{message:'Koneksi data sementara gagal.'}}}:{json:{records:[record],reviews:[],after_event_id:0,active_batch:null}});});
 await page.route('**/api/sessions/*/overview',r=>r.fulfill({json:{status:'ready',records:[record],calculation}}));
 await page.goto('/?view=Laporan');await expect(page.getByRole('button',{name:'Muat ulang data',exact:true})).toBeVisible();
 const input=page.getByLabel('Laporan atau pertanyaan Anda');await input.fill('Draf tetap ada setelah mencoba kembali');
 await page.getByRole('button',{name:'Muat ulang data',exact:true}).click();
 if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 await expect(page.getByRole('region',{name:'Ringkasan seluruh posko'})).toContainText('100 jiwa terdata');
 await expect(input).toHaveValue('Draf tetap ada setelah mencoba kembali');expect(recovery).toBe(2);
});

test('stored records and cached candidate calculations remain usable while overview is pending',async({page})=>{
 await setup(page);let release!:()=>void;const held=new Promise<void>(r=>{release=r;});
 const candidate={...record,total_people:120,male:55,female:65,update_target:{batch_id:record.batch_id,report_id:record.report_id}};
 const preview={snapshot_id:'a'.repeat(32),snapshot_sha256:'b'.repeat(64),records:[candidate]};
 await page.route('**/api/sessions/*/recovery',r=>r.fulfill({json:{records:[record],reviews:[{batchId:'c'.repeat(32),preview,gap:{shelters:[{...candidate,needs:{air_liter_per_hari:{value:1800}}}]}}],after_event_id:0,active_batch:null}}));
 await page.route('**/api/sessions/*/overview',async r=>{await held;await r.fulfill({json:{status:'partial',records:[record],calculation:null}}).catch(()=>{});});
 try{
  await page.goto('/');await expect(page.getByText('Memuat kebutuhan…',{exact:true})).toBeVisible();
  const panel=await summary(page);await expect(panel).toContainText('120 jiwa terdata');await expect(panel).toContainText('1.800 L/hari');
  await page.getByRole('navigation').getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Rekap posko',exact:true})).toBeVisible();
  release();await expect(page.getByRole('button',{name:'Muat ulang data',exact:true})).toBeVisible();
  await page.getByRole('navigation').getByRole('button',{name:'Laporan',exact:true}).click();
  await expect(page.getByRole('region',{name:'Ringkasan seluruh posko'})).toContainText('120 jiwa terdata');
 }finally{release();}
});
