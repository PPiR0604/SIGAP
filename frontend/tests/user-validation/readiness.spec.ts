import {test,expect} from '@playwright/test';

test('Docker live membaca seed dan kalkulasi seluruh posko; model menjawab tanpa menyimpan',async({page},testInfo)=>{
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  let writes=0;
  await page.route('**/api/batches/*/decisions',r=>{writes++;return r.abort();});
  const connected=page.waitForResponse(r=>r.url().endsWith('/api/sessions')&&r.ok());
  await page.goto('/');await connected;
  await expect(page.getByRole('region',{name:'Selamat datang di SIGAP'})).toHaveCount(0);
  const health=await(await page.request.get('/api/health')).json();expect(health.mode).toBe('live');
  const token=await page.evaluate(()=>localStorage.getItem('sigap_token'));
  const send=async(text:string)=>{
    const accepted=page.waitForResponse(r=>/\/messages$/.test(r.url())&&r.ok());
    await page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'}).fill(text);
    await page.getByRole('button',{name:'Kirim',exact:true}).click();
    const {batch_id}=await(await accepted).json();
    let batch:any;
    await expect.poll(async()=>{
      batch=await(await page.request.get(`/api/batches/${batch_id}`,{headers:{Authorization:`Bearer ${token}`}})).json();
      return batch.status;
    },{timeout:140_000,intervals:[1000,2000,5000]}).toMatch(/conversation_done|ready_for_review|failed|payload_invalid|needs_review/);
    return batch;
  };
  const all=await send('Periksa kebutuhan di semua desa berdasarkan seluruh rekap tersimpan. Hanya membaca dan menghitung, jangan menyimpan.');
  expect(all.status).toBe('conversation_done');
  expect(all.gap.shelters).toHaveLength(8);
  expect(all.gap.totals.total_people).toBe(630);
  expect(all.gap.totals.air_liter_per_hari).toBe(9450);
  const find=(name:string,village:string)=>all.gap.shelters.find((row:any)=>row.shelter_name===name&&row.village===village);
  expect(find('Posko Pelita','Cipandan').gaps.air_liter_per_hari).toBe(810);
  expect(find('Posko Nusa','Sukamaju').gaps.air_liter_per_hari??null).toBeNull();
  expect(find('Posko Melati','Cisarua').gaps.air_liter_per_hari??null).toBeNull();
  expect(find('Posko Teduh','Mekarsari').gaps.air_liter_per_hari).toBe(0);
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  await page.getByRole('button',{name:'Kebutuhan',exact:true}).click();
  await expect(page.locator('tbody')).toContainText('1.500 L/hari');
  await page.screenshot({path:testInfo.outputPath('rekap-user-testing-live.png'),fullPage:true});
  await page.getByRole('button',{name:'Laporan',exact:true}).click();
  const model=await send('Halo. Jawab singkat: apa fungsi SIGAP untuk petugas posko? Jangan memanggil tool atau mengubah data.');
  await testInfo.attach('readiness-summary',{contentType:'application/json',body:Buffer.from(JSON.stringify({synthetic:true,provider:health.agent,model:health.model,shelters:8,total_people:630,calculation_status:all.status,model_status:model.status,external_writes:writes}))});
  expect(model.status,'Provider harus benar-benar menjawab, bukan hanya terkonfigurasi.').toBe('conversation_done');
  expect(writes).toBe(0);
});
