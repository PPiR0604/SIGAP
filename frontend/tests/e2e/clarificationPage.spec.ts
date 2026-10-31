import {test,expect,type Page} from '@playwright/test';
const a={batch_id:'stored-a',report_id:'R001',shelter_name:'Posko Harapan',village:'Desa A',total_people:100,total_families:20,male:45,female:55,infants_toddlers:0,children:8,elderly:4,pregnant:0,breastfeeding:0,disability:0,urgent_needs:['air bersih']};
const b={...a,batch_id:'stored-b',report_id:'R002',village:'Desa B',total_families:null,missing_fields:['total_families']};
async function workspace(page:Page){
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:`id: 1\nevent: stored_rekap_ready\ndata: ${JSON.stringify({records:[a,b]})}\n\n`}));
 await page.goto('/?view=Rekap');await expect(page.getByLabel('Filter desa',{exact:true})).toBeVisible();
 await page.getByLabel('Cari posko atau desa',{exact:true}).fill('Harapan');
 await page.getByLabel('Filter desa',{exact:true}).selectOption('Desa B');
 await page.getByRole('button',{name:'Posko Harapan',exact:true}).click();
 return page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true});
}

test('full-page editing keeps sections, drafts, origin filters and browser history without a modal',async({page},testInfo)=>{
 const detail=await workspace(page);await expect(page).toHaveURL(/view=Klarifikasi.*posko=/);
 await expect(page.locator('dialog[open]')).toHaveCount(0);
 const fields=detail.getByRole('group',{name:'Bagian formulir klarifikasi'});
 await detail.getByRole('spinbutton',{name:'Jumlah KK',exact:true}).fill('24');
 await fields.getByRole('button',{name:'Kebutuhan & stok',exact:true}).click();
 await detail.getByLabel('Stok air bersih',{exact:true}).fill('2000');
 await detail.getByLabel('Periode stok air bersih (jam)',{exact:true}).fill('48');
 await detail.getByRole('group',{name:'Jenis stok'}).getByRole('button',{name:'Jamban',exact:true}).click();
 await detail.getByLabel('Stok jamban',{exact:true}).fill('5');
 await detail.getByRole('group',{name:'Jenis stok'}).getByRole('button',{name:'Air bersih',exact:true}).click();
 await expect(detail.getByLabel('Stok air bersih',{exact:true})).toHaveValue('2000');
 await expect(detail.locator('.stock-editor:visible')).toHaveCount(1);
 await fields.getByRole('button',{name:'Catatan',exact:true}).click();
 await detail.getByLabel('Catatan klarifikasi (opsional)').fill('Draf Desa B');
 await detail.getByRole('button',{name:'Kembali',exact:true}).click();
 await expect(page.getByLabel('Filter desa',{exact:true})).toHaveValue('Desa B');
 await expect(page.getByLabel('Cari posko atau desa',{exact:true})).toHaveValue('Harapan');
 await page.goForward();await expect(detail).toBeVisible();
 await expect(detail.getByRole('spinbutton',{name:'Jumlah KK',exact:true})).toHaveValue('24');
 await fields.getByRole('button',{name:'Kebutuhan & stok',exact:true}).click();
 await expect(detail.getByLabel('Stok air bersih',{exact:true})).toHaveValue('2000');
 await fields.getByRole('button',{name:'Catatan',exact:true}).click();
 await expect(detail.getByLabel('Catatan klarifikasi (opsional)')).toHaveValue('Draf Desa B');
 for(const width of [375,768,1024,1440]){
  await page.setViewportSize({width,height:950});await fields.getByRole('button',{name:'Data posko',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const action=detail.getByRole('button',{name:'Validasi perubahan',exact:true}),bounds=(await action.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(950);
  if(width>=1024){const [reference,form]=await Promise.all([detail.locator('.clarification-reference').boundingBox(),detail.locator('.clarification-editor').boundingBox()]);expect(reference!.x+reference!.width).toBeLessThan(form!.x);expect(form!.width).toBeGreaterThan(400);}
 }
 await page.screenshot({path:testInfo.outputPath('clarification-full-page.png'),fullPage:true});
});

test('reload restores the exact server identity and draft; an unknown identity never opens another shelter',async({page})=>{
 const detail=await workspace(page);await detail.getByRole('spinbutton',{name:'Jumlah KK',exact:true}).fill('27');
 await page.reload();await expect(detail.getByRole('spinbutton',{name:'Jumlah KK',exact:true})).toHaveValue('27');await expect(detail).toContainText('Desa B');
 await detail.getByRole('button',{name:'Kembali',exact:true}).click();await expect(page).toHaveURL(/view=Rekap/);
 const url=new URL(page.url());url.searchParams.set('view','Klarifikasi');url.searchParams.set('posko','unknown-server-identity');await page.goto(url.href);
 await expect(page.getByRole('heading',{name:'Posko tidak ditemukan',exact:true})).toBeVisible();
 await expect(page.getByRole('form',{name:'Form klarifikasi'})).toHaveCount(0);
});

test('validation submits only the selected shelter and approval remains an explicit modal decision',async({page})=>{
 const detail=await workspace(page);let payload:any,writes=0;
 page.on('request',r=>{if(r.url().endsWith('/decisions'))writes++;});
 await page.route('**/api/sessions/*/messages',r=>{payload=r.request().postDataJSON();return r.fulfill({status:409,json:{error:{message:'Coba kembali.'}}});});
 await detail.getByRole('spinbutton',{name:'Jumlah KK',exact:true}).fill('23');
 await detail.getByRole('button',{name:'Validasi perubahan',exact:true}).click();
 await expect.poll(()=>payload?.correction?.target?.batch_id).toBe('stored-b');
 expect(payload.correction.target.report_id).toBe('R002');expect(payload.correction.changes.totalFamilies).toBe(23);
 await expect(detail.getByRole('alert')).toContainText('Coba kembali');await expect(detail.getByRole('spinbutton',{name:'Jumlah KK',exact:true})).toHaveValue('23');expect(writes).toBe(0);
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:`id: 2\nevent: preview_ready\ndata: ${JSON.stringify({batch_id:'c'.repeat(32),snapshot_id:'d'.repeat(32),records:[{...b,total_families:23,update_target:{batch_id:b.batch_id,report_id:b.report_id}}]})}\n\n`}));
 await detail.getByRole('button',{name:'Tinjau & simpan perubahan',exact:true}).click();
 const approval=page.getByRole('dialog',{name:'Tinjau persetujuan',exact:true});await expect(approval).toBeVisible();
 await expect(approval.getByRole('checkbox',{name:/Saya menyetujui/})).not.toBeChecked();expect(writes).toBe(0);
 await approval.getByRole('button',{name:'Tutup dialog',exact:true}).click();await expect(detail).toBeVisible();await expect(page).toHaveURL(/view=Klarifikasi/);
});

test('left and right clarification panels share page scrolling and focused fields stay clear of fixed controls',async({page})=>{
 await page.setViewportSize({width:1024,height:650});const detail=await workspace(page);
 const reference=detail.getByRole('complementary',{name:'Data pembanding posko'});
 await reference.getByRole('button',{name:'Perhitungan',exact:true}).click();
 await reference.locator('.sphere-method > summary').click();
 await expect.poll(()=>reference.evaluate(el=>getComputedStyle(el).overflowY)).not.toBe('auto');
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 const box=(await reference.boundingBox())!;await page.mouse.move(box.x+40,Math.min(box.y+100,500));await page.mouse.wheel(0,140);
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(30);const first=await page.evaluate(()=>scrollY);
 await page.mouse.move(800,350);await page.mouse.wheel(0,140);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(first+30);
 expect(await reference.evaluate(el=>el.scrollTop)).toBe(0);
 await reference.getByRole('button',{name:'Pemeriksaan',exact:true}).click();
 await reference.getByRole('button',{name:'Jumlah KK · Lengkapi',exact:true}).click();
 const field=detail.getByRole('spinbutton',{name:'Jumlah KK',exact:true});await expect(field).toBeFocused();
 const header=await page.locator('.app-header').boundingBox(),actions=await detail.locator('.clarification-actions').boundingBox();
 await expect.poll(async()=>{const bounds=(await field.boundingBox())!;return bounds.y>=header!.y+header!.height&&bounds.y+bounds.height<=actions!.y;}).toBe(true);
});
