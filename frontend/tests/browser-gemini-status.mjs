// Run against local Gemini backend with GEMINI_API_KEY='' (explicitly unavailable).
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(path.join(process.env.SIGAP_BROWSER_PACKAGES||process.cwd(),'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.SIGAP_BROWSER_EXECUTABLE?{executablePath:process.env.SIGAP_BROWSER_EXECUTABLE}:{})});
try{
  const context=await browser.newContext();
  await context.addInitScript(()=>localStorage.setItem('sigap_token','sigap-local-review-test'));
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const sessionReady=page.waitForResponse(response=>response.url().endsWith('/api/sessions')&&response.ok());
  await page.goto(process.env.SIGAP_BROWSER_TEST_URL||'http://127.0.0.1:5173');await sessionReady;
  await page.getByRole('button',{name:'LLM belum siap'}).click();
  await page.getByText('Gemini',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Tutup',exact:true}).click();
  await page.getByLabel('Laporan atau pertanyaan Anda').fill('Posko Uji 10 jiwa.');
  await page.getByRole('button',{name:'Kirim laporan',exact:true}).click();
  await page.getByText('Runtime tidak dapat menyelesaikan proses. Periksa key/configuration agen dan koneksi MCP.').waitFor();
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  assert.equal(await page.locator('tbody tr').count(),0);
  assert.equal(await page.getByRole('button',{name:'Tinjau & setujui'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Backend Mock'}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: Gemini unavailable labelled correctly; no silent demo candidate or write approval; no JavaScript errors.');
}finally{await browser.close();}
