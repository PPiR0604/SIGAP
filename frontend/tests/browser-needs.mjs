// UI validation uses intercepted synthetic data; no real storage writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(path.join(process.env.SIGAP_BROWSER_PACKAGES||process.cwd(),'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.SIGAP_BROWSER_EXECUTABLE?{executablePath:process.env.SIGAP_BROWSER_EXECUTABLE}:{})});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'UI test only'}));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  assert.equal(await page.locator('tbody tr').count(),6);
  assert.match(await page.locator('tbody').innerText(),/Minyak goreng/);
  assert.match(await page.locator('tbody').innerText(),/Popok/);
  assert.match(await page.locator('tbody').innerText(),/Obat-obatan/);
  await page.getByRole('button',{name:'Kebutuhan',exact:true}).click();
  for(const key of ['air_liter_per_hari','kkal_per_hari','jamban_unit','ruang_hunian_m2']){
    await page.getByLabel('Jenis kebutuhan').selectOption(key);
    assert.equal(await page.locator('tbody tr').count(),6);
    assert.match(await page.locator('tbody').innerText(),/Obat-obatan/);
    if(key!=='air_liter_per_hari')assert.match(await page.locator('tbody').innerText(),/Belum diketahui/,'Missing demo calculations must stay unknown');
  }
  await mkdir('../output',{recursive:true});
  await page.screenshot({path:'../output/recap-needs-desktop.png',fullPage:true});
  await page.setViewportSize({width:375,height:812});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page fits viewport');
  await page.screenshot({path:'../output/recap-needs-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: all reported items, four category choices, honest unknowns, desktop/mobile layout.');
}finally{await browser.close();}
