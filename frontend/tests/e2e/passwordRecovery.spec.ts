import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',mode:'live',agent:'openai'}}));
});
test('forgot password sends only after explicit submit and preserves rate-limit guidance',async({page})=>{
 let requests=0;let body:any;
 await page.route('**/api/auth/password/reset',r=>{requests++;body=r.request().postDataJSON();return r.fulfill({status:429,json:{error:{message:'Tunggu satu menit sebelum mencoba lagi.'}}});});
 await page.goto('/');await page.getByRole('button',{name:'Lupa kata sandi?',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Lupa kata sandi?',exact:true})).toBeVisible();expect(requests).toBe(0);
 await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');await page.getByRole('button',{name:'Kirim tautan pemulihan'}).click();
 await expect(page.getByRole('alert')).toHaveText('Tunggu satu menit sebelum mencoba lagi.');expect(requests).toBe(1);expect(body).toEqual({email:'fixture@example.test'});
 await expect(page.getByLabel('Email',{exact:true})).toHaveValue('fixture@example.test');
 await page.getByRole('button',{name:'Kembali ke halaman masuk'}).click();await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
});
test('recovery callback strips credentials, validates confirmation and never grants app access',async({page})=>{
 let requests=0;let body:any;let bearer='';
 await page.route('**/api/auth/password/recover',r=>{requests++;body=r.request().postDataJSON();bearer=r.request().headers().authorization;return r.fulfill({status:204});});
 await page.goto('/?auth=recovery#access_token=synthetic-recovery-access-token&refresh_token=synthetic-refresh-secret&type=recovery');
 await expect(page.getByRole('heading',{name:'Buat kata sandi baru'})).toBeVisible();expect(requests).toBe(0);
 expect(await page.evaluate(()=>location.hash+location.search)).toBe('');
 await page.getByLabel('Kata sandi baru',{exact:true}).fill('Uji12345');await page.getByLabel('Konfirmasi kata sandi baru',{exact:true}).fill('Beda1234');
 await page.getByRole('button',{name:'Simpan kata sandi baru'}).click();await expect(page.getByRole('alert')).toContainText('belum sama');expect(requests).toBe(0);
 await page.getByLabel('Konfirmasi kata sandi baru',{exact:true}).fill('Uji12345');await page.getByRole('button',{name:'Simpan kata sandi baru'}).click();
 await expect(page.getByRole('status')).toContainText('berhasil diperbarui');expect(requests).toBe(1);expect(body).toEqual({password:'Uji12345'});expect(bearer).toBe('Bearer synthetic-recovery-access-token');
 expect(await page.evaluate(()=>JSON.stringify({...sessionStorage,...localStorage}))).not.toContain('synthetic-recovery');
 await expect(page.getByRole('navigation')).toHaveCount(0);await page.getByRole('button',{name:'Kembali ke halaman masuk'}).click();await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('expired recovery stays on recovery form and requires a new explicit email request',async({page})=>{
 let mails=0;await page.route('**/api/auth/password/reset',r=>{mails++;return r.fulfill({status:202,json:{message:'Permintaan diterima.'}});});
 await page.route('**/api/auth/password/recover',r=>r.fulfill({status:401,json:{error:{code:'RECOVERY_EXPIRED',message:'Tautan sudah tidak berlaku. Minta tautan baru.'}}}));
 await page.goto('/?auth=recovery#access_token=synthetic-expired-recovery-token&type=recovery');
 await expect(page.getByRole('heading',{name:'Buat kata sandi baru'})).toBeVisible();
 await page.getByLabel('Kata sandi baru',{exact:true}).fill('Uji12345');await page.getByLabel('Konfirmasi kata sandi baru',{exact:true}).fill('Uji12345');await page.getByRole('button',{name:'Simpan kata sandi baru'}).click();
 await expect(page.getByRole('alert')).toContainText('tidak berlaku');await expect(page.getByLabel('Email',{exact:true})).toBeVisible();expect(mails).toBe(0);
 await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');await page.getByRole('button',{name:'Kirim tautan pemulihan'}).click();await expect(page.getByRole('status')).toHaveText('Permintaan diterima.');expect(mails).toBe(1);
});
test('an invalid recovery callback never exposes provider text or attempts password update',async({page})=>{
 let calls=0;page.on('request',r=>{if(r.url().includes('/api/auth/password'))calls++;});
 await page.goto('/?auth=recovery#error=access_denied&error_code=otp_expired&error_description=private-provider-secret');
 await expect(page.getByRole('alert')).toContainText('kedaluwarsa');await expect(page.getByLabel('Email',{exact:true})).toBeVisible();await expect(page.locator('body')).not.toContainText('private-provider-secret');expect(await page.evaluate(()=>location.hash+location.search)).toBe('');expect(calls).toBe(0);
});
