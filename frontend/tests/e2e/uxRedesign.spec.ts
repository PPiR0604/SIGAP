import {test,expect,type Page} from '@playwright/test';
const record={batch_id:'stored-a',report_id:'R001',shelter_name:'Posko Harapan',village:'Desa A',total_people:100,total_families:20,male:45,female:55,infants_toddlers:0,children:8,elderly:4,pregnant:0,breastfeeding:0,disability:0,urgent_needs:['air bersih'],reported_at:'2026-10-29 08:00'};
const other={...record,batch_id:'stored-b',report_id:'R002',shelter_name:'Posko Harapan',village:'Desa B',total_families:null,infants_toddlers:null,missing_fields:['total_families','infants_toddlers']};
async function workspace(page:Page,records:unknown[]=[record,other]){let seq=0;const events:{id:number;body:string}[]=[];const emit=(event:string,data:unknown)=>{const id=++seq;events.push({id,body:`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`});};await page.emulateMedia({reducedMotion:'reduce'});await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': heartbeat\n\n'}));emit('stored_rekap_ready',{records});await page.goto('/');await expect(page.getByRole('heading',{name:'Tugas petugas'})).toBeVisible();await expect(page.getByRole('button',{name:'Lengkapi data',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('tugas.png'),fullPage:true});return emit;}
test('task opens the missing field and corrections retain zero, family counts and 48-hour stock',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Lengkapi data',exact:true}).click();const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});await expect(dialog.getByRole('form',{name:'Form klarifikasi'})).toBeVisible();await dialog.getByRole('spinbutton',{name:'Jumlah KK',exact:true}).fill('21');await dialog.getByRole('spinbutton',{name:'Bayi/balita',exact:true}).fill('0');await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Kebutuhan & stok',exact:true}).click();await dialog.getByLabel('Stok air bersih',{exact:true}).fill('0');await dialog.getByLabel('Waktu stok air bersih',{exact:true}).fill('2026-10-29T08:15');await dialog.getByLabel('Periode stok air bersih (jam)',{exact:true}).fill('48');let payload:any;await page.route('**/api/sessions/*/messages',r=>{payload=r.request().postDataJSON();return r.fulfill({status:409,json:{error:{message:'Tunggu proses sebelumnya.'}}});});await dialog.getByRole('button',{name:'Validasi perubahan'}).click();await expect.poll(()=>payload?.correction?.changes?.totalFamilies).toBe(21);expect(payload.correction.target.batch_id).toBe('stored-b');expect(payload.correction.changes.toddler).toBe(0);expect(payload.correction.changes.stock.air_liter_per_hari).toBe(0);expect(payload.correction.changes.stockContext.air_liter_per_hari.horizon_hours).toBe(48);await expect(dialog.getByRole('alert')).toContainText('Tunggu proses sebelumnya');
});
test('draft stays with its server identity when closing and opening another same-name shelter',async({page})=>{
 await workspace(page);await page.getByRole('button',{name:'Lengkapi data',exact:true}).click();const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});await dialog.getByRole('spinbutton',{name:'Jumlah KK',exact:true}).fill('24');await dialog.getByRole('button',{name:'Kembali',exact:true}).click();await page.getByRole('button',{name:'Laporan',exact:true}).click();if((await page.viewportSize())!.width<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();await page.getByLabel('Pilih posko pratinjau').selectOption({label:'Posko Harapan · Desa A'});await page.getByRole('button',{name:'Periksa & klarifikasi Posko Harapan',exact:true}).click();if(await dialog.getByRole('button',{name:'Tulis klarifikasi'}).count())await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();await expect(dialog.getByRole('spinbutton',{name:'Jumlah KK',exact:true})).toHaveValue('20');await dialog.getByRole('button',{name:'Kembali',exact:true}).click();await page.getByRole('button',{name:'Tugas',exact:true}).click();await page.getByRole('button',{name:'Lengkapi data',exact:true}).click();await expect(dialog.getByRole('spinbutton',{name:'Jumlah KK',exact:true})).toHaveValue('24');
});
test('navigation, responsive review and keyboard tooltip work at supported widths',async({page})=>{
 await workspace(page);for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:950});await page.getByRole('button',{name:'Laporan',exact:true}).click();if(width<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();const summary=page.getByRole('region',{name:'Ringkasan seluruh posko'});if(await summary.getByRole('button',{name:'Buka status pemeriksaan',exact:true}).count())await summary.getByRole('button',{name:'Buka status pemeriksaan',exact:true}).click();const help=summary.getByRole('button',{name:'Arti status pemeriksaan'});await help.focus();await help.press('Enter');await expect(summary.locator('.status-help-content')).toBeVisible();await help.press('Escape');await page.getByRole('button',{name:'Rekap',exact:true}).click();await expect(page.getByRole('heading',{name:'Rekap posko',exact:true})).toBeVisible();if(width<=760)await expect(page.locator('.recap-mobile-list')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}await page.goBack();await expect(page.getByRole('button',{name:'Laporan',exact:true})).toHaveAttribute('aria-current','page');
});
test('bulletin references stay bound to its source when another candidate arrives',async({page})=>{
 const emit=await workspace(page);emit('bulletin_ready',{batch_id:'bulletin-a',content:'# Buletin\n\n100 jiwa terdata.',source_metadata:{snapshot_id:'source-version-a',records:[record],generated_at:'2026-10-29T01:00:00Z',kind:'stored'}});await page.getByRole('button',{name:'Buletin',exact:true}).click();await expect(page.getByRole('article',{name:'Isi draf buletin'})).toContainText('100 jiwa');emit('preview_ready',{batch_id:'b'.repeat(32),snapshot_id:'c'.repeat(32),records:[{...other,total_people:110,male:55,female:55,update_target:{batch_id:'stored-b',report_id:'R002'}}]});await expect(page.getByText('Data sumber berubah; susun ulang untuk memakai data terbaru.',{exact:true})).toBeVisible();await page.getByText('Rincian sumber dan versi',{exact:true}).click();await expect(page.getByRole('group',{name:'Rincian sumber buletin'})).toContainText('source-version-a');await expect(page.getByRole('group',{name:'Rincian sumber buletin'})).toContainText('100 jiwa');
});

test('modal errors remain keyboard accessible and help closes when leaving the page',async({page})=>{
 await workspace(page);
 await page.getByRole('button',{name:'Laporan',exact:true}).click();
 if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 const summary=page.getByRole('region',{name:'Ringkasan seluruh posko'});
 await summary.getByRole('button',{name:'Buka status pemeriksaan',exact:true}).click();
 await summary.getByRole('button',{name:'Arti status pemeriksaan'}).click();
 await expect(summary.locator('.status-help-content')).toBeVisible();
 await page.getByRole('button',{name:'Rekap',exact:true}).click();await page.goBack();
 await expect(summary.locator('.status-help-content')).toBeHidden();
 await page.getByRole('button',{name:'Tugas',exact:true}).click();await page.getByRole('button',{name:'Lengkapi data',exact:true}).click();
 const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});await dialog.getByRole('spinbutton',{name:'Jumlah KK',exact:true}).fill('-1');
 await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
 await expect(dialog.getByRole('alert')).toBeFocused();
 await expect(dialog.getByRole('spinbutton',{name:'Jumlah KK',exact:true})).toHaveAttribute('aria-invalid','true');
 await expect(page.locator('dialog[open]')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Kembali',exact:true}).click();await expect(dialog).toBeHidden();
 // 720 CSS px is the reflow width of a 1440 px window at 200% browser zoom.
 await page.setViewportSize({width:720,height:450});await page.getByRole('button',{name:'Rekap',exact:true}).click();await expect(page.locator('.recap-mobile-list')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('stock fields explain quantities, timestamps and periods without changing source values',async({page},testInfo)=>{
 await workspace(page);await page.getByRole('button',{name:'Lengkapi data',exact:true}).click();
 const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});
 await expect(dialog.getByLabel('Waktu laporan',{exact:true})).toHaveAccessibleDescription(/Kapan kondisi posko ini dilaporkan/);
 await expect(dialog.getByLabel('Jumlah jiwa merupakan estimasi',{exact:true})).toHaveAccessibleDescription(/masih perkiraan/);
 await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Kebutuhan & stok',exact:true}).click();
 const water=dialog.getByLabel('Stok air bersih',{exact:true});
 const time=dialog.getByLabel('Waktu stok air bersih',{exact:true});
 const period=dialog.getByLabel('Periode stok air bersih (jam)',{exact:true});
 await expect(water).toHaveAccessibleDescription(/Total air yang tersedia/);
 await expect(time).toHaveAccessibleDescription(/Bukan tanggal kedaluwarsa/);
 await expect(period).toHaveAccessibleDescription(/24 jam = 1 hari; 48 jam = 2 hari/);
 await expect(dialog.getByLabel('Stok energi pangan',{exact:true})).toHaveAccessibleDescription(/Bukan berat bahan pangan/);
 await expect(dialog.getByLabel('Stok jamban',{exact:true})).toHaveAccessibleDescription(/berfungsi/);
 await expect(dialog.getByLabel('Stok ruang hunian',{exact:true})).toHaveAccessibleDescription(/Bukan jumlah tenda/);
 await water.fill('2000');await time.fill('2026-10-29T08:25');await period.fill('48');
 const note=dialog.getByRole('group',{name:'Air bersih (L)',exact:true}).locator('.stock-period-guide');
 await expect(note).toContainText('Periode 48 jam:');
 await expect(note).toContainText('kekurangan belum dapat dihitung');
 await expect(water).toHaveValue('2000');await expect(period).toHaveValue('48');
 await note.scrollIntoViewIfNeeded();
 await dialog.getByRole('group',{name:'Air bersih (L)',exact:true}).screenshot({path:testInfo.outputPath('stock-field-guides.png')});
 await period.fill('24');await expect(note).toHaveCount(0);
 await expect(water).toHaveValue('2000');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('clarification tips float on hover or tap, preserve field sources, and close without closing the dialog',async({page},testInfo)=>{
 const provenance={male:{source_excerpt:'Jumlah laki-laki 45, dicatat petugas lapangan.',reported_at:'2026-10-29 08:00'}};
 await workspace(page,[{...record,field_provenance:provenance},{...other,field_provenance:provenance}]);
 await page.getByRole('button',{name:'Lengkapi data',exact:true}).click();
 const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});
 await expect(dialog.getByRole('heading',{name:'Rujukan sumber',exact:true})).toHaveCount(0);
 await expect(dialog.locator('.stock-field-help')).toHaveCount(0);
 await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Kebutuhan & stok',exact:true}).click();
 const input=dialog.getByLabel('Stok air bersih',{exact:true});
 const help=dialog.getByRole('button',{name:'Panduan stok air bersih',exact:true});
 const tip=page.getByRole('tooltip').filter({hasText:'Panduan stok air bersih'});
 await help.scrollIntoViewIfNeeded();
 const before=(await input.boundingBox())!.y;
 if(testInfo.project.name.startsWith('desktop')){
  await help.hover();await expect(tip).toBeVisible();
  await tip.hover();await expect(tip).toBeVisible();
  await page.mouse.move(0,0);await expect(tip).toBeHidden();
 }
 await help.focus();await help.press('Enter');await expect(tip).toBeVisible();
 await expect(tip).toContainText('2 tandon');
 expect(Math.abs((await input.boundingBox())!.y-before)).toBeLessThan(1);
 const box=(await tip.boundingBox())!,size=page.viewportSize()!;
 expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(size.width);
 expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(size.height);
 await help.press('Escape');await expect(tip).toBeHidden();await expect(dialog).toBeVisible();
 await help.click();await expect(tip).toBeVisible();await input.click();await expect(tip).toBeHidden();
 await dialog.getByRole('group',{name:'Bagian formulir klarifikasi'}).getByRole('button',{name:'Data posko',exact:true}).click();
 const source=dialog.getByRole('button',{name:'Sumber laki-laki',exact:true});
 await source.click();const evidence=page.getByRole('tooltip').filter({hasText:'Sumber laki-laki'});
 await expect(evidence).toContainText('Jumlah laki-laki 45, dicatat petugas lapangan.');
 await expect(evidence).toContainText('2026-10-29 08:00');
 await source.press('Escape');await expect(evidence).toBeHidden();await expect(dialog).toBeVisible();
 await dialog.getByRole('group',{name:'Bagian data pembanding'}).getByRole('button',{name:'Perhitungan',exact:true}).click();
 const method=dialog.locator('.sphere-method');
 await expect(method.locator('summary > svg')).toHaveCount(1);
 await method.locator('summary').click();await expect(method).toHaveAttribute('open','');
 await expect(method.getByRole('link',{name:'Baca acuan Sphere 2018'})).toBeVisible();
 await method.locator('summary').click();await expect(method).not.toHaveAttribute('open','');
 await dialog.getByRole('button',{name:'Panduan klarifikasi',exact:true}).click();
 await page.screenshot({path:testInfo.outputPath('compact-clarification-tooltip.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Kembali',exact:true}).click();await expect(page.getByRole('tooltip')).toHaveCount(0);
});
