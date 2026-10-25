import {test,expect} from './fixtures';

test('splash memakai logo yang diberikan, mengunci layar belakang lalu membuka workspace',async({page},testInfo)=>{
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  const start=new Date('2026-10-25T01:00:00Z');
  await page.clock.install({time:start});
  await page.clock.pauseAt(new Date(start.getTime()+1000));
  await page.goto('/');
  const splash=page.getByRole('region',{name:'Selamat datang di SIGAP'});
  await expect(splash).toBeVisible();
  await expect(splash.getByRole('img',{name:'SIGAP',exact:true})).toBeVisible();
  await expect(splash.getByRole('status')).toHaveText('Menyiapkan ruang kerja…');
  expect(await splash.getByRole('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(page.getByRole('navigation',{name:'Navigasi utama'})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('splash-screen.png')});
  await page.clock.runFor(1600);
  await expect(splash).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'Navigasi utama'})).toBeVisible();
  const mark=page.locator('.brand-mark img');
  expect(await mark.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(splash).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const favicon=page.locator('link[rel=icon]');
  await expect(favicon).toHaveAttribute('href',/Logo.*\.svg/);
});

test('reduced motion menonaktifkan animasi dan backend offline tidak menahan splash',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/health',r=>r.abort());
  const start=new Date('2026-10-25T01:00:00Z');
  await page.clock.install({time:start});await page.clock.pauseAt(new Date(start.getTime()+1000));await page.goto('/');
  const splash=page.getByRole('region',{name:'Selamat datang di SIGAP'});
  await expect(splash).toBeVisible();
  await expect(splash.locator('.startup-loader')).toHaveCSS('animation-name','none');
  await page.clock.runFor(800);
  await expect(splash).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Mode demo',exact:true})).toBeVisible();
});
