import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(path.join(process.env.SIGAP_BROWSER_PACKAGES||process.cwd(),'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.SIGAP_BROWSER_EXECUTABLE?{executablePath:process.env.SIGAP_BROWSER_EXECUTABLE}:{})});
try{
  const page=await browser.newPage();
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'UI test only'}));
  await page.goto(process.env.SIGAP_BROWSER_TEST_URL||'http://127.0.0.1:5173');
  for(const width of [1440,375]){
    await page.setViewportSize({width,height:900});
    let title;
    for(const name of ['Laporan','Rekap','Buletin']){
      await page.getByRole('button',{name,exact:true}).click();
      const size=await page.locator('h1').evaluate(el=>getComputedStyle(el).fontSize);
      if(name==='Laporan')title=size;else assert.equal(size,title,'Page titles share the same scale');
      const selector=name==='Laporan'?'.info-card p':name==='Rekap'?'.review-side-card p':'.bulletin-side p';
      assert.equal(await page.locator(selector).first().evaluate(el=>getComputedStyle(el).fontSize),'14px',`${name} body copy uses the same scale`);
      const section=name==='Laporan'?'.overview-card h2':name==='Rekap'?'.review-side-card h3':'.bulletin-side h3';
      assert.equal(await page.locator(section).first().evaluate(el=>getComputedStyle(el).fontSize),'16px','Panel headings share the same scale');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Typography must not introduce horizontal overflow');
    }
    await page.getByRole('button',{name:'Laporan',exact:true}).click();
    assert.equal(await page.locator('.chat-composer textarea').evaluate(el=>getComputedStyle(el).fontSize),'16px');
  }
  console.log('PASS: page titles, panel headings, body copy and inputs use consistent scales on desktop/mobile.');
}finally{await browser.close();}
