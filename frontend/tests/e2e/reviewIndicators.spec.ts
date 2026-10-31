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
  const isMobile=testInfo.project.name.startsWith('mobile');
  if(isMobile){
    await expect(page.locator('.recap-mobile-list > article')).toHaveCount(3);
    await expect(page.locator('.recap-mobile-list')).toContainText('Data belum lengkap');
    await page.locator('.recap-mobile-list > article').filter({hasText:'Posko Harapan'}).getByRole('button',{name:'Periksa posko'}).click();
  }else{
    await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(3);
    await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody')).toContainText('data belum dilaporkan');
    await page.getByRole('button',{name:'Lihat pemeriksaan Posko Harapan',exact:true}).click();
  }
  const dialog=page.getByRole('region',{name:'Halaman klarifikasi posko',exact:true}),review=dialog.getByRole('region',{name:'Rincian pemeriksaan data'});
  const missing=review.locator('.review-group.missing');
  await expect(missing).toContainText('Desa');
  await expect(missing).toContainText('Disabilitas');
  await expect(missing).toContainText('Jumlah KK');
  await expect(missing).toContainText('Anak');
  const stock=review.locator('.review-group.stock');
  await expect(stock).toContainText('Stok belum dilaporkan');
  await expect(stock).toContainText('air bersih');
  await expect(stock).toContainText('Kekurangan belum dapat dipastikan tanpa data stok.');
  const disclosure=review.locator('details');
  await expect(disclosure).toHaveAttribute('open','');
  await disclosure.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).not.toHaveAttribute('open','');
  await expect(missing).not.toBeVisible();
  await expect(review).toContainText('catatan');
  await page.keyboard.press('Enter');
  await expect(missing).toBeVisible();
  await expect(review.getByRole('heading',{name:'Perlu klarifikasi',exact:true})).toHaveCount(0);
  if(await dialog.getByRole('button',{name:'Tulis klarifikasi'}).count())await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();
  const desa=dialog.getByRole('textbox',{name:'Desa',exact:true});
  const disability=dialog.getByRole('spinbutton',{name:'Disabilitas',exact:true});
  await expect(desa).toHaveAccessibleDescription('Belum dilaporkan.');
  await expect(disability).toHaveAccessibleDescription('Belum dilaporkan.');
  await desa.fill('Sukamaju');
  await expect(desa).toHaveAccessibleDescription('Diisi, belum divalidasi.');
  await disability.fill('0');
  await expect(disability).toHaveAccessibleDescription('Diisi, belum divalidasi.');
  await dialog.getByRole('button',{name:'Batal',exact:true}).click();
  await dialog.screenshot({path:testInfo.outputPath('rincian-data-kurang.png')});
  await dialog.getByRole('button',{name:'Kembali',exact:true}).click();
  if(isMobile){
    await page.locator('.recap-mobile-list > article').filter({hasText:'Posko Cibening'}).getByRole('button',{name:'Periksa posko'}).click();
  }else{
    await page.getByRole('button',{name:'Lihat pemeriksaan Posko Cibening',exact:true}).click();
  }
  await expect(review.locator('.review-group.missing')).not.toContainText('Disabilitas');
  await dialog.getByRole('button',{name:'Kembali',exact:true}).click();
  if(isMobile){
    await page.locator('.recap-mobile-list > article').filter({hasText:'Nusa Sukamaju'}).getByRole('button',{name:'Periksa posko'}).click();
  }else{
    await page.getByRole('button',{name:'Lihat pemeriksaan Nusa Sukamaju',exact:true}).click();
  }
  await expect(dialog.locator('.badge')).toHaveText('Perlu klarifikasi');
  await expect(review).toContainText('jenis stok yang belum dikenali');
  await expect(review).toContainText('48 jam');
  await expect(review).not.toContainText('kkal_per_horizontal');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
