import {test,expect} from '@playwright/test';

for(const mode of ['register','login'] as const){
 test(`${mode} explains authentication failures and preserves the form`,async({page})=>{
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',mode:'live',agent:'openai'}}));
  const message=mode==='register'?'Terlalu banyak percobaan pendaftaran. Coba lagi sebentar.':'Email atau kata sandi tidak valid.';
  await page.route('**/api/auth/'+mode,r=>r.fulfill({status:mode==='register'?429:403,json:{error:{code:mode==='register'?'AUTH_RATE_LIMITED':'LOGIN_REJECTED',message}}}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
  if(mode==='register'){await page.getByRole('button',{name:'Daftar akun',exact:true}).click();await page.getByLabel('Nama tampilan',{exact:true}).fill('Petugas Uji');}
  await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');await page.getByLabel('Kata sandi',{exact:true}).fill('Uji12345');
  await page.getByRole('button',{name:mode==='register'?'Daftar':'Masuk',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText(message);await expect(page.getByLabel('Email',{exact:true})).toHaveValue('fixture@example.test');await expect(page.getByRole('navigation')).toHaveCount(0);
 });
}

for(const mode of ['register','login'] as const){
 test(`${mode} accepts eight characters and blocks seven before sending`,async({page})=>{
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',mode:'live',agent:'openai'}}));
  let submissions=0,password='';
  await page.route('**/api/auth/'+mode,r=>{submissions++;password=r.request().postDataJSON().password;return r.fulfill({status:mode==='register'?202:401,json:mode==='register'?{message:'Pendaftaran diterima.'}:{error:{message:'Permintaan login diterima penyedia.'}}});});
  await page.goto('/');await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
  if(mode==='register'){await page.getByRole('button',{name:'Daftar akun',exact:true}).click();await page.getByLabel('Nama tampilan',{exact:true}).fill('Petugas Uji');}
  await page.getByLabel('Email',{exact:true}).fill('password-policy@example.test');
  const input=page.getByLabel('Kata sandi',{exact:true}),submit=page.getByRole('button',{name:mode==='register'?'Daftar':'Masuk',exact:true});
  await expect(input).toHaveAttribute('minlength','8');
  await input.fill('Uji1234');await submit.click();
  expect(await input.evaluate((el:HTMLInputElement)=>el.validity.tooShort)).toBe(true);expect(submissions).toBe(0);
  await input.fill('Uji12345');await submit.click();
  await expect.poll(()=>submissions).toBe(1);expect(password).toBe('Uji12345');
  await expect(page.getByText(mode==='register'?'Pendaftaran diterima.':'Permintaan login diterima penyedia.',{exact:true})).toBeVisible();
 });
}
