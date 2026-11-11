import {test,expect} from '@playwright/test';

// Boundary diagnostic: metadata uses the in-memory mock backend; no shelter write is approved.
test('respons hilang: retry manual mengembalikan batch yang sama',async({page},testInfo)=>{
  await page.goto('/offline');
  const text='Laporan sintetis uji koneksi: Posko Antrean 10 jiwa. Stok air belum diketahui.';
  await page.getByLabel('Catat laporan').fill(text);
  await page.getByRole('button',{name:'Simpan di perangkat'}).click();
  await expect(page.getByText('1 laporan di perangkat')).toBeVisible();
  await page.goto('/');
  await page.getByRole('navigation',{name:'Navigasi utama'}).getByRole('button',{name:'Laporan',exact:true}).click();
  await page.getByText('Antrean laporan di perangkat',{exact:true}).first().click();
  await page.getByRole('button',{name:'Siapkan untuk diproses'}).click();
  const accepted:Array<{request_id:string;batch_id:string}>=[];
  let attempts=0,canonicalWrites=0;
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/decisions'))canonicalWrites++;});
  await page.route('**/api/sessions/*/messages',async route=>{
    attempts++;
    const response=await route.fetch();
    const body=await response.json();
    if(response.ok)accepted.push({request_id:route.request().postDataJSON().request_id,batch_id:body.batch_id});
    if(attempts===1)await route.abort('connectionreset');
    else await route.fulfill({response});
  });
  const composer=page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'});
  await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await expect.poll(()=>accepted.length).toBe(1);
  await expect(composer).toHaveValue(text);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
  await expect(page.getByRole('button',{name:'Kirim',exact:true})).toBeEnabled();
  expect(attempts).toBe(1);
  // A person explicitly retries after the connection returns.
  await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await expect.poll(()=>accepted.length).toBe(2);
  expect(accepted[0].request_id).toBe(accepted[1].request_id);
  expect(accepted[0].batch_id).toBe(accepted[1].batch_id);
  expect(canonicalWrites).toBe(0);
  await page.reload();
  await page.getByRole('navigation',{name:'Navigasi utama'}).getByRole('button',{name:'Laporan',exact:true}).click();
  await page.getByText('Antrean laporan di perangkat',{exact:true}).first().click();
  await page.getByRole('button',{name:'Siapkan lagi'}).click();
  await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('sesi sebelumnya');
  expect(accepted).toHaveLength(2);
  await testInfo.attach('offline-delivery-diagnostic',{contentType:'application/json',body:Buffer.from(JSON.stringify({synthetic:true,attempts,distinctBatches:new Set(accepted.map(x=>x.batch_id)).size,distinctRequestIds:new Set(accepted.map(x=>x.request_id)).size,canonicalWrites,manualRetryDeduplicated:true}))});
});
