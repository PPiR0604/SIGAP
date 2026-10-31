import {test,expect,type Page} from '@playwright/test';

const a={batch_id:'stored-a',report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:100,male:40,female:60,elderly:4,disability:0,urgent_needs:['air bersih','tandon air','beras']};
const b={...a,batch_id:'stored-b',report_id:'R002',shelter_name:'Posko B',village:'Desa B',total_people:null,male:null,female:null,urgent_needs:['air bersih']};
const c={...a,batch_id:'stored-c',report_id:'R003',shelter_name:'Posko C',total_people:0,male:0,female:0,elderly:0,urgent_needs:['obat']};
async function workspace(page:Page,records:unknown[]=[a,b,c]){
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 let id=0;const events:{id:number;body:string}[]=[];
 const emit=(type:string,data:unknown)=>{const next=++id;events.push({id:next,body:`id: ${next}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`});};
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
 emit('stored_rekap_ready',{records});await page.goto('/?view=Laporan');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();
 if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 return emit;
}
const overview=(page:Page)=>page.getByRole('region',{name:'Ringkasan seluruh posko'});
const toggle=(page:Page)=>overview(page).getByRole('button',{name:/^(Buka|Ciutkan) total kebutuhan$/});
const composer=(page:Page)=>page.getByLabel('Laporan atau pertanyaan Anda',{exact:true});
async function writeDraft(page:Page,text:string){
 const mobile=(page.viewportSize()?.width??1440)<=760;
 if(mobile)await page.getByRole('button',{name:'Tulis laporan',exact:true}).click();
 await composer(page).fill(text);
 if(mobile)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
}

test('petunjuk status dapat dibuka lewat ikon dan keyboard',async({page},testInfo)=>{
 await page.emulateMedia({reducedMotion:'reduce'});await workspace(page);await overview(page).getByRole('button',{name:'Buka status pemeriksaan'}).click();
 const help=overview(page).getByRole('button',{name:'Arti status pemeriksaan'});
 const content=overview(page).locator('.status-help-content');
 const bars=overview(page).getByRole('region',{name:'Status pemeriksaan seluruh posko'}).locator('.status-chart-layout');
 const heading=overview(page).getByRole('region',{name:'Status pemeriksaan seluruh posko'}).locator('.status-heading');
 const before=(await bars.boundingBox())!.y-(await heading.boundingBox())!.y;
 await expect(content).toBeHidden();
 if(testInfo.project.name.startsWith('desktop')){
  await help.hover();await expect(content).toBeVisible();
  await page.mouse.move(0,0);await expect(content).toBeHidden();
 }
 await help.focus();await help.press('Enter');
 await expect(help).toHaveAttribute('aria-expanded','true');
 await expect(content).toBeVisible();
 expect(Math.abs(((await bars.boundingBox())!.y-(await heading.boundingBox())!.y)-before)).toBeLessThan(1);
 for(const label of ['Perlu klarifikasi','Data belum lengkap','Siap diperiksa','Penyimpanan'])await expect(content.locator('dt').getByText(label,{exact:true})).toBeVisible();
 await expect(content).toContainText('tidak berarti sudah disetujui');
 await help.press('Escape');await expect(content).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('expanded layout has three columns with diagrams on the far left; collapse restores two',async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});await workspace(page);
 const grid=page.locator('.laporan-workspace'),chat=page.getByRole('region',{name:'Percakapan laporan'}),preview=page.getByRole('region',{name:'Pratinjau rekap',exact:true});
 const columns=()=>grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(/\s+/).length);
 expect(await columns()).toBe(3);await expect(page.locator('#report-needs-panel')).toBeHidden();const compactWidth=(await overview(page).boundingBox())!.width;
 await writeDraft(page,'Draf tetap ada saat panel bergeser');await toggle(page).click();await expect(overview(page)).toBeVisible();await expect.poll(async()=>Math.abs((await overview(page).boundingBox())!.width - compactWidth)).toBeLessThanOrEqual(1);
 const positions=await Promise.all([overview(page),chat,preview].map(p=>p.boundingBox()));
 expect(positions[0]!.x+positions[0]!.width).toBeLessThan(positions[1]!.x);expect(positions[1]!.x+positions[1]!.width).toBeLessThan(positions[2]!.x);
 expect(Math.abs(positions[0]!.y-positions[1]!.y)).toBeLessThan(2);
 // Keep the writing surface usable at common laptop widths, not just on a large monitor.
 for(const width of [1100,1280,1440,1920]){
  await page.setViewportSize({width,height:1000});
  const [diagram,conversation,recap]=await Promise.all([overview(page),chat,preview].map(p=>p.boundingBox()));
  expect(conversation!.width,`Chat width at ${width}px`).toBeGreaterThanOrEqual(480);
  expect(conversation!.width).toBeGreaterThan(diagram!.width);expect(conversation!.width).toBeGreaterThan(recap!.width);
  expect((await composer(page).boundingBox())!.width,`Writing space at ${width}px`).toBeGreaterThanOrEqual(400);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:1440,height:1000});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('laporan-tiga-kolom.png'),fullPage:true});
 await toggle(page).click();await expect(page.locator('#report-needs-panel')).toBeHidden();await expect(toggle(page)).toBeFocused();await expect(composer(page)).toHaveValue('Draf tetap ada saat panel bergeser');
 await page.setViewportSize({width:320,height:812});await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();await toggle(page).click();expect(await columns()).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Tulis laporan',exact:true}).click();await expect(composer(page)).toHaveValue('Draf tetap ada saat panel bergeser');
});

test('compact overview opens with keyboard, counts all shelters once per category and retains input',async({page},testInfo)=>{
 await workspace(page);const summary=overview(page);await expect(summary.locator('.report-summary-card')).toContainText('3 posko · 100 jiwa terdata');await expect(page.locator('#report-needs-panel')).toBeHidden();await expect(toggle(page)).toHaveAttribute('aria-expanded','false');
 await writeDraft(page,'Draf laporan yang belum dikirim');let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
 await toggle(page).focus();await toggle(page).press('Enter');
 const needs=summary.getByRole('group',{name:'Kebutuhan seluruh posko'});
 await expect(needs).toContainText('Belum dihitung');await expect(needs.getByRole('button',{name:'Rincian air bersih',exact:true})).toBeVisible();
 await summary.getByRole('button',{name:'Buka status pemeriksaan'}).click();await expect(summary.getByRole('region',{name:'Status pemeriksaan seluruh posko'}).getByRole('listitem')).toHaveCount(3);await expect(summary).toContainText('Jumlah jiwa 1 posko belum diketahui');await expect(summary).toContainText('Rekap tersimpan');
 await expect(composer(page)).toHaveValue('Draf laporan yang belum dikirim');
 if(testInfo.project.name.startsWith('mobile'))await page.setViewportSize({width:320,height:812});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await summary.screenshot({path:testInfo.outputPath('ringkasan-laporan.png')});
 await toggle(page).focus();await toggle(page).press('Enter');await expect(page.locator('#report-needs-panel')).toBeHidden();await expect(toggle(page)).toBeFocused();await expect(needs).toBeHidden();await expect(composer(page)).toHaveValue('Draf laporan yang belum dikirim');expect(writes).toBe(0);
});
test('selection does not narrow global counts; live corrections update overview without closing or losing draft',async({page})=>{
 const emit=await workspace(page);const summary=overview(page);await toggle(page).click();await writeDraft(page,'Tetap menulis saat data diperbarui');
 await page.getByLabel('Pilih posko pratinjau').selectOption({label:'Posko B · Desa B'});await expect(summary.locator('.report-summary-card')).toContainText('3 posko');
 emit('preview_ready',{batch_id:'d'.repeat(32),snapshot_id:'e'.repeat(32),records:[{...a,batch_id:'candidate-a',total_people:120,male:50,female:70,urgent_needs:['selimut'],update_target:{batch_id:a.batch_id,report_id:a.report_id}}]});
 await expect(summary.locator('.report-summary-card')).toContainText('3 posko · 120 jiwa terdata');await expect(summary).toContainText('Ada perubahan belum disimpan');await expect(summary).toBeVisible();await expect(toggle(page)).toHaveAttribute('aria-expanded','true');
 await expect(summary.getByRole('group',{name:'Kebutuhan seluruh posko'})).toContainText('Belum dihitung');await expect(composer(page)).toHaveValue('Tetap menulis saat data diperbarui');
 await summary.getByRole('button',{name:'Lihat rekap'}).click();await expect(page.getByRole('heading',{name:'Rekap posko',exact:true})).toBeFocused();await expect((page.viewportSize()?.width??1440)<=760?page.locator('.recap-mobile-list > article'):page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(3);
 await page.getByRole('button',{name:'Laporan',exact:true}).click();await expect(composer(page)).toHaveValue('Tetap menulis saat data diperbarui');
});
test('empty, unknown and explicit zero population remain distinct and updates work while collapsed',async({page})=>{
 const emit=await workspace(page,[]);const summary=overview(page);await toggle(page).click();await expect(summary).toContainText('Belum ada data posko');await expect(summary).toContainText('Belum ada data kebutuhan');
 emit('stored_rekap_ready',{records:[b]});await expect(summary.locator('.report-summary-card')).toContainText('1 posko · Belum diketahui jiwa terdata');
 await toggle(page).click();emit('stored_rekap_ready',{records:[c]});await expect(summary.locator('.report-summary-card')).toContainText('1 posko · 0 jiwa terdata');await toggle(page).click();await expect(summary).not.toContainText('Jumlah jiwa 1 posko belum diketahui');
});


test('overview actions open the matching recap filter without sending or approving data',async({page})=>{
 const emit=await workspace(page);await toggle(page).click();emit('calculation_ready',{shelters:[{shelter_name:a.shelter_name,village:a.village,needs:{air_liter_per_hari:{value:1500}}}]});await writeDraft(page,'Draf tetap tersedia');
 let writes=0;page.on('request',request=>{if(request.method()==='POST')writes++;});
 const needs=overview(page).getByRole('group',{name:'Kebutuhan seluruh posko'});
 await expect(needs).toContainText('1.500');await needs.getByRole('button',{name:'Rincian air bersih',exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('group',{name:'Hasil filter rekap'})).toBeFocused();
 await expect(page.getByRole('group',{name:'Hasil filter rekap'})).toContainText('3 dari 3 posko ditampilkan');await expect(page.getByRole('combobox',{name:'Jenis kebutuhan',exact:true})).toHaveValue('air_liter_per_hari');
 await page.goBack();await expect(composer(page)).toHaveValue('Draf tetap tersedia');
 await overview(page).getByRole('button',{name:'Buka status pemeriksaan'}).click();
 const incomplete=overview(page).getByRole('button',{name:/Data belum lengkap: .* posko/});
 await incomplete.click();
 await expect(page.getByRole('combobox',{name:'Filter status',exact:true})).toHaveValue('Parsial');
 await expect(page.getByRole('group',{name:'Hasil filter rekap'})).toBeFocused();
 await page.goBack();await overview(page).getByRole('button',{name:'Lihat rekap',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Filter status',exact:true})).toHaveValue('Semua status');
 await expect(page.getByRole('group',{name:'Hasil filter rekap'})).toContainText('3 dari 3 posko ditampilkan');
 expect(writes).toBe(0);
});


test('overview pie has a legend and quantities keep their own units, zero and missing calculations',async({page},testInfo)=>{
 const emit=await workspace(page);await toggle(page).click();const summary=overview(page);await summary.getByRole('button',{name:'Buka status pemeriksaan'}).click();
 const needPanel=summary.getByRole('region',{name:'Panel total kebutuhan'}),statusPanel=summary.getByRole('region',{name:'Status pemeriksaan seluruh posko'});
 await expect(needPanel).toBeVisible();await expect(statusPanel).toBeVisible();expect((await needPanel.boundingBox())!.y).toBeLessThan((await statusPanel.boundingBox())!.y);
 await expect(summary.getByRole('img',{name:/Sebaran status 3 posko/})).toBeVisible();
 await expect(summary.getByRole('list',{name:'Jumlah posko per status'}).getByRole('listitem')).toHaveCount(3);
 await expect(summary.locator('.status-pie-visual svg circle[r="42"]')).toHaveCount(0);
 emit('calculation_ready',{shelters:[
  {shelter_name:a.shelter_name,village:a.village,needs:{air_liter_per_hari:{value:1500},kkal_per_hari:{value:210000},jamban_unit:{value:5},ruang_hunian_m2:{value:350}}},
  {shelter_name:c.shelter_name,village:c.village,needs:{air_liter_per_hari:{value:0},kkal_per_hari:{value:0},jamban_unit:{value:0},ruang_hunian_m2:{value:0}}}
 ]});
 const needs=summary.getByRole('group',{name:'Kebutuhan seluruh posko'});
 let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
 await expect(needs.getByRole('combobox')).toHaveCount(0);
 for(const [label,value,unit] of [['air bersih','1.500','L/hari'],['pangan (energi)','210.000','kkal/hari'],['jamban','5','unit'],['ruang hunian','350','m²']]){
  await expect(needs.getByRole('button',{name:`Rincian ${label}`,exact:true})).toContainText(`${value} ${unit}`);
 }
 await expect(needs.getByRole('img')).toHaveCount(4);
 await expect(needs.getByRole('img').first()).not.toHaveAttribute('aria-label',/Posko A/);
 await toggle(page).click();await toggle(page).click();await expect(needs.getByRole('img')).toHaveCount(4);
 for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await summary.screenshot({path:testInfo.outputPath('pie-and-quantity-histogram.png')});expect(writes).toBe(0);
});

test('calculating missing overview quantities uses the existing read-only workflow',async({page})=>{
 await workspace(page);await toggle(page).click();let payload:any,writes=0;
 page.on('request',r=>{if(r.url().endsWith('/decisions'))writes++;});
 await page.route('**/api/sessions/*/messages',r=>{payload=r.request().postDataJSON();return r.fulfill({status:409,json:{error:{message:'Tunggu proses sebelumnya.'}}});});
 await overview(page).getByRole('button',{name:'Hitung kebutuhan',exact:true}).click();
 await expect.poll(()=>payload?.text).toContain('Hitung kebutuhan seluruh posko');expect(writes).toBe(0);
});
