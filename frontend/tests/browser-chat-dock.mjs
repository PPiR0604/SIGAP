// Synthetic backend only: validates fixed positioning and upward expansion.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(path.join(process.env.SIGAP_BROWSER_PACKAGES||process.cwd(),'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.SIGAP_BROWSER_EXECUTABLE?{executablePath:process.env.SIGAP_BROWSER_EXECUTABLE}:{})});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'Demo only'}));
  await page.goto(process.env.SIGAP_BROWSER_TEST_URL||'http://127.0.0.1:5173');
  const rect=()=>page.locator('.chat-dock').evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width};});
  const collapsed=await rect();
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  assert.deepEqual(await rect(),collapsed,'Scrolling the page must not move the dock');
  await page.getByRole('button',{name:'Buka percakapan',exact:true}).click();
  const expanded=await rect();assert.equal(expanded.bottom,collapsed.bottom);assert.ok(expanded.top<collapsed.top,'Panel expands upward');
  await page.getByRole('button',{name:'Ciutkan percakapan',exact:true}).click();
  await page.getByLabel('Laporan atau pertanyaan Anda').fill('Posko Uji, 10 jiwa.');
  await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await page.locator('.chat-message.assistant').waitFor();
  for(let i=0;i<3;i++){
    await page.getByLabel('Laporan atau pertanyaan Anda').fill(`Laporan tambahan ${i}`);
    await page.getByRole('button',{name:'Kirim',exact:true}).click();
  }
  assert.equal(await page.locator('.chat-message').count(),8,'History retains all messages');
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  assert.equal(await page.locator('.chat-message').count(),8,'Changing tab preserves the conversation');
  await mkdir('../output',{recursive:true});
  await page.screenshot({path:'../output/chat-dock-desktop.png'});
  for(const viewport of [{width:375,height:812},{width:812,height:375}]){
    await page.setViewportSize(viewport);
    const panel=await rect();
    assert.ok(panel.top>=0&&panel.bottom<=viewport.height,'Expanded panel must fit the viewport');
    const input=page.getByLabel('Laporan atau pertanyaan Anda');
    const bounds=await input.boundingBox();
    assert.ok(bounds&&bounds.width>=100,'Mobile composer retains usable typing space');
    await input.fill('Uji input pada layar kecil');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile must not overflow');
    await page.screenshot({path:`../output/chat-dock-${viewport.width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: compact sticky dock, upward expansion, minimize, send, full history, tab persistence, phone and landscape.');
}finally{await browser.close();}
