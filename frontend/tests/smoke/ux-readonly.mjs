// Read-only smoke against the running Docker UI. Never submits email or credentials.
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const url=process.argv[2]||'http://localhost:5173/';
const output=new URL('../../test-results/live-ux/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 let writes=0;
 await context.route('**/api/**',async route=>{
  if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){writes++;await route.abort();return;}
  await route.continue();
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(url);expect(response.status()).toBe(200);
 await expect(page.getByRole('heading',{name:'Masuk ke SIGAP',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Lupa kata sandi?',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Lupa kata sandi?',exact:true})).toBeVisible();
 await expect(page.getByLabel('Email',{exact:true})).toHaveValue('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:fileURLToPath(new URL('pemulihan-mobile.png',output)),fullPage:true});
 await page.getByRole('button',{name:'Kembali ke halaman masuk'}).click();
 await expect(page.getByRole('heading',{name:'Masuk ke SIGAP',exact:true})).toBeVisible();
 expect(writes).toBe(0);expect(errors).toEqual([]);
 console.log('Docker UI: login and recovery visible on mobile; no overflow, JavaScript errors or mutation requests.');
}finally{await browser.close();}
