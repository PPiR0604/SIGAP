import {test,expect} from './fixtures';

test('rekap tersimpan menjelaskan kekurangan, masalah stok dan nilai nol di desktop/mobile',async({page},testInfo)=>{
  const records=[
    {report_id:'R001',shelter_name:'Posko Cibening',village:'',total_people:100,male:55,female:45,disability:0,missing_fields:['village','infants_toddlers'],stock:{air_liter_per_hari:null},urgent_needs:['air bersih']},
    {report_id:'R002',shelter_name:'Posko Harapan',village:'',total_people:98,male:43,female:55,total_families:null,children:null,disability:null,missing_fields:['village','disability'],stock:{},urgent_needs:[]},
    {report_id:'R006',shelter_name:'Nusa Sukamaju',village:'',total_people:120,male:59,female:61,missing_fields:['village'],stock:{air_liter_per_hari:2000},stock_context:{air_liter_per_hari:{recorded_at:'2026-10-02 08:25',horizon_hours:48}},stock_issues:['Key stok tidak dikenal: kkal_per_horizontal.']},
    {report_id:'R003',shelter_name:'Posko Lengkap',village:'Desa A',total_people:10,male:4,female:6,disability:0,missing_fields:[]}
  ];
  const frame=(event:string,data:any)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:frame('stored_rekap_ready',{records})+frame('processing_completed',{})}));
  await page.goto('/');await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await page.getByLabel('Filter status').selectOption('Perlu pemeriksaan');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('tbody')).toContainText('Desa belum dilaporkan');
  await page.getByRole('button',{name:'Lihat pemeriksaan Posko Harapan',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Detail laporan'}),review=dialog.getByRole('region',{name:'Rincian pemeriksaan data'});
  await expect(review).toContainText('Desa belum dilaporkan.');
  await expect(review).toContainText('Disabilitas belum dilaporkan.');
  await expect(review).toContainText('Jumlah KK belum dilaporkan.');
  await expect(review).toContainText('Anak belum dilaporkan.');
  await expect(review).toContainText('Stok air bersih belum dilaporkan');
  await expect(review.getByRole('heading',{name:'Perlu klarifikasi',exact:true})).toHaveCount(0);
  await dialog.screenshot({path:testInfo.outputPath('rincian-data-kurang.png')});
  await dialog.getByRole('button',{name:'Tutup dialog'}).click();
  await page.getByRole('button',{name:'Lihat pemeriksaan Posko Cibening',exact:true}).click();
  await expect(review).not.toContainText('Disabilitas belum dilaporkan');
  await dialog.getByRole('button',{name:'Tutup dialog'}).click();
  await page.getByRole('button',{name:'Lihat pemeriksaan Nusa Sukamaju',exact:true}).click();
  await expect(dialog.locator('.badge')).toHaveText('Perlu klarifikasi');
  await expect(review).toContainText('jenis stok yang belum dikenali');
  await expect(review).toContainText('48 jam');
  await expect(review).not.toContainText('kkal_per_horizontal');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
