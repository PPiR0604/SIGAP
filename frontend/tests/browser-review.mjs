// Run against local Vite + mock backend only. Uses an isolated browser profile.
// SIGAP_BROWSER_PACKAGES: directory containing the installed playwright package.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.SIGAP_BROWSER_PACKAGES || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.SIGAP_BROWSER_EXECUTABLE ? { executablePath: process.env.SIGAP_BROWSER_EXECUTABLE } : {}) });
let releaseMessage, releaseDecision;
try {
  const context = await browser.newContext();
  await context.addInitScript(token => localStorage.setItem('sigap_token', token), process.env.SIGAP_BROWSER_TEST_TOKEN || 'sigap-local-review-test');
  const page = await context.newPage();
  const jsErrors = [];
  page.on('pageerror', error => jsErrors.push(error.message));
  let messageRequests = 0, decisionRequests = 0;
  const messageHeld = new Promise(resolve => { releaseMessage = resolve; });
  const decisionHeld = new Promise(resolve => { releaseDecision = resolve; });
  await page.route('**/api/sessions/*/messages', async route => {
    messageRequests++;
    if(messageRequests === 1){
      const response = await route.fetch();
      await messageHeld;
      await route.fulfill({response});
    }else{
      await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{message:'Batch sebelumnya masih aktif (tes regresi).'}})});
    }
  });
  await page.route('**/api/batches/*/decisions', async route => {
    decisionRequests++;
    await decisionHeld;
    await route.continue();
  });
  const eventsConnected = page.waitForRequest(request => request.url().includes('/events'));
  await page.goto(process.env.SIGAP_BROWSER_TEST_URL || 'http://127.0.0.1:5173');
  await eventsConnected;
  await page.getByRole('button',{name:'Backend Mock'}).waitFor();
  await page.getByLabel('Laporan atau pertanyaan Anda').fill('Laporan sintetis untuk uji lokal.');
  await page.getByRole('button',{name:'Kirim laporan',exact:true}).click();
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await page.getByRole('button',{name:'Posko Harapan',exact:true}).waitFor();
  assert.equal(await page.locator('tbody tr').count(),2,'SSE preview is displayed while HTTP response is held');
  releaseMessage();
  await page.getByRole('button',{name:'Tinjau & setujui'}).waitFor();
  await page.waitForFunction(() => !document.querySelector('.review-actions button')?.disabled);
  assert.equal(await page.locator('tbody tr').count(),2,'HTTP acceptance must preserve the earlier SSE candidate');
  await page.getByRole('button',{name:'Tinjau & setujui'}).click();
  await page.getByLabel('Keputusan R001 disability').selectOption('keep');
  await page.getByLabel('Saya memahami rekap masih parsial dan konflik belum selesai.').check();
  await page.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
  await page.getByRole('button',{name:'Konfirmasi persetujuan'}).click();
  await page.getByRole('button',{name:'Tutup dialog'}).click();
  await page.getByRole('button',{name:'Laporan',exact:true}).click();
  await page.getByLabel('Laporan atau pertanyaan Anda').fill('Laporan berikutnya masih harus menunggu.');
  assert.equal(await page.getByRole('button',{name:'Memproses...'}).isDisabled(),true,'New submission stays locked during commit');
  assert.equal(messageRequests,1);
  releaseDecision();
  await page.getByText('Simulasi penyimpanan selesai. Tidak ada data ditulis ke penyimpanan nyata.').waitFor();
  assert.equal(decisionRequests,1);
  await page.getByRole('button',{name:'Kirim laporan',exact:true}).click();
  await page.getByText('Batch sebelumnya masih aktif (tes regresi).').waitFor();
  assert.equal(await page.getByLabel('Laporan atau pertanyaan Anda').inputValue(),'Laporan berikutnya masih harus menunggu.');
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  assert.equal(await page.locator('tbody tr').count(),2,'Rejected new batch must preserve reviewed rows');
  await page.getByText('Keputusan simulasi tercatat. Tidak ada penulisan nyata.').waitFor();
  assert.equal(await page.getByText('Tersimpan dan terverifikasi di penyimpanan.',{exact:true}).count(),0,'Mock cannot claim real storage');
  assert.deepEqual(jsErrors,[]);
  console.log('PASS: early SSE preview preserved; commit locks submission; rejected message preserves candidate; mock never claims real storage.');
}finally{
  releaseMessage?.(); releaseDecision?.();
  await browser.close();
}
