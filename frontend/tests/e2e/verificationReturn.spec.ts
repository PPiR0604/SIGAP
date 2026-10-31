import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',mode:'live',agent:'openai'}}));
});
test('legacy email links are cleaned and direct users to password login without resend',async({page})=>{
 let sends=0;await page.route('**/api/auth/resend-verification',r=>{sends++;return r.abort();});
 await page.goto('/#error=access_denied&error_code=otp_expired&error_description=private-description');
 await expect(page.getByRole('status')).toContainText('Tautan email lama tidak diperlukan');expect(sends).toBe(0);
 expect(await page.evaluate(()=>location.hash)).toBe('');await expect(page.locator('body')).not.toContainText('private-description');await expect(page.getByRole('button',{name:'Kirim ulang verifikasi'})).toHaveCount(0);await expect(page.getByLabel('Kata sandi',{exact:true})).toBeVisible();
});

test('callback removes credential fragments and still requires authenticated sign-in',async({page})=>{
 await page.goto('/#access_token=synthetic-access-secret&refresh_token=synthetic-refresh-secret&type=signup');
 await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('Silakan masuk');expect(await page.evaluate(()=>location.hash)).toBe('');
 expect(await page.evaluate(()=>sessionStorage.getItem('sigap_auth_session'))).toBeNull();await expect(page.getByRole('navigation')).toHaveCount(0);
});
