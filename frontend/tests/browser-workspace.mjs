// UI checks use demo data only. Real backend requests are intercepted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(path.join(process.env.SIGAP_BROWSER_PACKAGES||process.cwd(),'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.SIGAP_BROWSER_EXECUTABLE?{executablePath:process.env.SIGAP_BROWSER_EXECUTABLE}:{})});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'UI test only'}));
  await page.goto(process.env.SIGAP_BROWSER_TEST_URL||'http://127.0.0.1:5173');
  await mkdir('../output',{recursive:true});
  for(const width of [1440,1000,768,375]){
    await page.setViewportSize({width,height:900});
    let home;
    for(const name of ['Laporan','Rekap','Buletin']){
      await page.getByRole('button',{name,exact:true}).click();
      const bounds=await page.locator('main').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,width:r.width,left:s.paddingLeft,right:s.paddingRight,top:s.paddingTop};});
      if(name==='Laporan'){
        home=bounds;
        assert.equal(await page.locator('.chat-dock').evaluate(el=>getComputedStyle(el).position),'static','Chat is inline and never overlays content');
      }
      else assert.deepEqual(bounds,home,`${name} must share Home margins at ${width}px`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} must fit at ${width}px`);
      if([1440,375].includes(width))await page.screenshot({path:`../output/workspace-${name.toLowerCase()}-${width}.png`,fullPage:true});
    }
  }
  await page.getByRole('button',{name:'Laporan',exact:true}).click();
  await page.getByLabel('Laporan atau pertanyaan Anda').fill('Posko Uji, 10 jiwa.');
  await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await page.locator('.chat-message.assistant').waitFor();
  assert.match(await page.locator('.chat-message.user').textContent(),/Posko Uji/);
  await page.getByRole('button',{name:'Ciutkan percakapan',exact:true}).click();
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await page.getByRole('button',{name:'Posko Cibening',exact:true}).click();
  await page.locator('dialog[open]').waitFor();
  await page.getByRole('button',{name:'Tutup dialog',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log('PASS: all tab margins match Home, desktop/mobile have no overflow, demo chat and posko dialog work.');
}finally{await browser.close();}
