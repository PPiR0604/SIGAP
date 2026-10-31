import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',mode:'live',agent:'openai'}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
});

test('mode switch responds without losing input on desktop and mobile',async({page})=>{
  await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
  await page.getByLabel('Email',{exact:true}).fill('petugas@example.test');
  await page.getByRole('button',{name:'Daftar akun',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Daftar akun SIGAP'})).toBeVisible();
  await expect(page.getByLabel('Email',{exact:true})).toHaveValue('petugas@example.test');
  await page.getByRole('button',{name:'Sudah punya akun? Masuk',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
  await expect(page.getByLabel('Email',{exact:true})).toHaveValue('petugas@example.test');
  if(test.info().project.name.startsWith('mobile'))await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('registration.png'),fullPage:true});
});

test('field hints explain invalid values and password reveal never submits the form',async({page})=>{
  let submissions=0;await page.route('**/api/auth/register',r=>{submissions++;return r.fulfill({status:202,json:{message:'Permintaan diterima.'}});});
  await page.getByRole('button',{name:'Daftar akun',exact:true}).click();
  const email=page.getByLabel('Email',{exact:true}),password=page.getByLabel('Kata sandi',{exact:true});
  await email.fill('bukan-email');await password.focus();
  await expect(email).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#auth-email-hint')).toContainText('Periksa format email');
  await password.fill('1234567');await email.focus();
  await expect(password).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#auth-password-hint')).toContainText('minimal 8 karakter');
  await password.fill('Uji12345');
  await expect(password).toHaveAttribute('aria-invalid','false');
  await expect(page.locator('#auth-password-hint')).toContainText('sudah memenuhi');
  await page.getByRole('button',{name:'Tampilkan kata sandi'}).click();
  await expect(password).toHaveAttribute('type','text');expect(submissions).toBe(0);
  await page.getByRole('button',{name:'Sembunyikan kata sandi'}).click();
  await expect(password).toHaveAttribute('type','password');
  await email.fill('petugas@example.test');
  await page.getByLabel('Nama tampilan',{exact:true}).fill('   ');
  await page.getByRole('button',{name:'Daftar',exact:true}).click();
  await expect(page.getByLabel('Nama tampilan',{exact:true})).toBeFocused();
  expect(submissions).toBe(0);
});

test('registration waits for completion then offers password sign-in without email confirmation',async({page})=>{
  let submissions=0,release!:()=>void;
  const responseReady=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/auth/register',async r=>{submissions++;await responseReady;await r.fulfill({status:202,json:{message:'Pendaftaran berhasil. Silakan masuk dengan email dan kata sandi.'}});});
  await page.getByRole('button',{name:'Daftar akun',exact:true}).click();
  await page.getByLabel('Nama tampilan',{exact:true}).fill('Petugas Uji');
  await page.getByLabel('Email',{exact:true}).fill('petugas@example.test');
  await page.getByLabel('Kata sandi',{exact:true}).fill('Uji12345');
  await page.getByRole('button',{name:'Daftar',exact:true}).click();
  try{
    await expect(page.getByRole('button',{name:'Mengirim permintaan…',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Daftar akun',exact:true})).toBeDisabled();
    await expect(page.getByLabel('Email',{exact:true})).toBeDisabled();
    expect(submissions).toBe(1);
  }finally{release();}
  await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Silakan masuk');
  await expect(page.getByRole('button',{name:'Kirim ulang verifikasi',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
  await expect(page.getByLabel('Email',{exact:true})).toHaveValue('petugas@example.test');
  await expect(page.getByLabel('Kata sandi',{exact:true})).toHaveValue('');
  await expect(page.locator('.auth-feedback')).toBeFocused();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('successful sign-in replaces registration guidance with the actual pending-access status',async({page})=>{
  await page.route('**/api/auth/register',r=>r.fulfill({status:202,json:{message:'Permintaan diterima.'}}));
  await page.route('**/api/auth/login',r=>r.fulfill({json:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,profile:{user_id:'fixture-user',display_name:'Petugas Uji',organization_id:null,role:null,status:'pending',scopes:[]}}}));
  await page.getByRole('button',{name:'Daftar akun',exact:true}).click();
  await page.getByLabel('Nama tampilan',{exact:true}).fill('Petugas Uji');
  await page.getByLabel('Email',{exact:true}).fill('petugas@example.test');
  await page.getByLabel('Kata sandi',{exact:true}).fill('Uji12345');
  await page.getByRole('button',{name:'Daftar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Kirim ulang verifikasi',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
  await page.getByLabel('Kata sandi',{exact:true}).fill('Uji12345');
  await page.getByRole('button',{name:'Masuk',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Akses ruang kerja'})).toBeVisible();
  await expect(page.getByText('Akses operasional menunggu aktivasi dan penugasan admin.',{exact:true})).toBeVisible();
  await expect(page.getByText('Berikutnya: periksa email Anda',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
});
