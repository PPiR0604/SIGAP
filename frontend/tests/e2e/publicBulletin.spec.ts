import {test,expect} from '@playwright/test';
const token='p'.repeat(43),path=`/publikasi/${token}`;
const data={schema_version:'sigap-public-bulletin-v1',content:'# Buletin Operasi Uji\n\nAir bersih dibutuhkan.\n\n## Kebutuhan yang tercatat dalam laporan\n\n- Air bersih (diminta 2 posko)\n- Beras (diminta 1 posko)\n\n**Data estimasi tetap ditandai.**\n\n![tracker](https://tracker.invalid/private.png)\n\n<script>alert(1)</script>',context_name:'Operasi Uji',generated_at:'2026-10-30T01:00:00Z',approved_at:'2026-10-30T02:00:00Z',source:{version:'abcdef123456',kind:'stored'},calculation_available:true,records:[
 {report_id:'P1',shelter_name:'Posko A',village:'Desa A',total_people:10,male:4,female:6,children:2,infants_toddlers:0,elderly:1,breastfeeding:0,pregnant:0,disability:0,quality:'Siap ditinjau',urgent_needs:[{item:'air bersih',qty:100,unit:'liter'},{item:'beras',qty:10,unit:'kg'}],requirements:{air_liter_per_hari:150,kkal_per_hari:21000,jamban_unit:1,ruang_hunian_m2:35},shortages:{air_liter_per_hari:0}},
 {report_id:'P2',shelter_name:'Posko B',village:'Desa B',total_people:20,male:12,female:9,is_estimate:true,quality:'Perlu klarifikasi',urgent_needs:['pangan'],requirements:{air_liter_per_hari:300,kkal_per_hari:42000,jamban_unit:1,ruang_hunian_m2:70},shortages:{}},
 {report_id:'P3',shelter_name:'Posko C',village:null,total_people:null,quality:'Parsial',urgent_needs:[],requirements:{},shortages:{}}
]};
test.beforeEach(async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
});

test('anonymous readers see the approved text, diagrams and full source data without auth calls',async({page,context},info)=>{
 const calls:string[]=[];let remoteImages=0;
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))calls.push(new URL(r.url()).pathname);if(r.url().includes('tracker.invalid'))remoteImages++;});
 await page.route('**/api/public/bulletins/*',r=>{expect(r.request().headers().authorization).toBeUndefined();return r.fulfill({json:data});});
 await page.goto(path);await expect(page.getByRole('heading',{name:'Operasi Uji',exact:true})).toBeVisible();
 await expect(page.getByRole('article',{name:'Isi publikasi buletin'})).toContainText('Air bersih dibutuhkan');
 const diagrams=page.getByRole('region',{name:'Diagram kebutuhan publikasi'});await expect(diagrams.getByRole('button',{name:/Detail /})).toHaveCount(4);
 await expect(diagrams.getByLabel('Legenda diagram')).toContainText('Acuan kebutuhan');await expect(diagrams.getByLabel('Legenda diagram')).toContainText('Kekurangan diketahui');
 const bar=diagrams.getByRole('button',{name:'Detail Air bersih'});await bar.hover();await expect(diagrams.getByRole('tooltip')).toContainText('Kekurangan: 0 L/hari');await expect(diagrams.getByRole('tooltip')).toContainText('1 dari 3 posko');
 await bar.focus();await page.keyboard.press('Escape');await expect(diagrams.getByRole('tooltip')).toHaveCount(0);
 for(const value of ['450 L/hari','63.000 kkal/hari','2 unit','105 m²'])await expect(diagrams).toContainText(value);
 await expect(diagrams).toContainText('1 posko belum dihitung');
 await expect(page.getByRole('button',{name:'Masuk',exact:true})).toHaveCount(0);expect(calls.every(c=>c.startsWith('/api/public/bulletins/'))).toBe(true);expect(remoteImages).toBe(0);
 await expect(diagrams).toContainText('Kekurangan: 0 L/hari');await expect(diagrams).toContainText('Kekurangan diketahui untuk 1 dari 3 posko');await expect(diagrams).toContainText('Belum diketahui');
 await expect(page.getByRole('region',{name:'Data posko dalam publikasi'})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Status pemeriksaan'})).toHaveCount(0);
 const table=page.getByRole('table');await expect(table).toContainText('Air bersih');await expect(table).toContainText('2 posko');await expect(table).toContainText('Beras');
 await expect(table).toContainText('100 liter (1 posko memiliki jumlah)');await expect(table).toContainText('10 kg');
 await expect(page.getByRole('region',{name:'Cakupan publikasi'})).toContainText('30 jiwa terdata');await expect(page.getByRole('region',{name:'Cakupan publikasi'})).toContainText('3 posko');
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.getByRole('button',{name:'Salin tautan',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(path);
 for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const positions=await diagrams.locator('.public-need-row').evaluateAll(rows=>rows.map(row=>({x:row.getBoundingClientRect().x,y:row.getBoundingClientRect().y})));if(width===375)expect(positions[1].y).toBeGreaterThan(positions[0].y);if(width===1440){expect(positions[1].x).toBeGreaterThan(positions[0].x);expect(positions[1].y).toBe(positions[0].y);expect(positions[2].y).toBeGreaterThan(positions[0].y);}}
 await page.screenshot({path:info.outputPath('public-bulletin.png'),fullPage:true});
});

test('revoked or invalid links stay outside login and can be retried after a network failure',async({page})=>{
 let mode='failure';await page.route('**/api/public/bulletins/*',r=>r.fulfill(mode==='failure'?{status:503,json:{}}:mode==='ready'?{json:data}:{status:404,json:{}}));
 await page.goto(path);await expect(page.getByRole('alert')).toContainText('belum dapat dimuat');mode='ready';await page.getByRole('button',{name:'Coba lagi',exact:true}).click();await expect(page.getByRole('article',{name:'Isi publikasi buletin'})).toBeVisible();
 mode='revoked';await page.reload();await expect(page.getByRole('alert')).toContainText('sudah dinonaktifkan');await expect(page.getByRole('article',{name:'Isi publikasi buletin'})).toHaveCount(0);
 await page.goto('/publikasi/invalid');await expect(page.getByRole('alert')).toContainText('Tautan tidak tersedia');await expect(page.getByRole('button',{name:'Masuk',exact:true})).toHaveCount(0);
});
