import {test,expect} from '@playwright/test';

test('new tester registers and enters their assigned practice workspace',async({page})=>{
 const profile={user_id:'tester-fixture',display_name:'Petugas Uji',organization_id:'org-fixture',role:'petugas',status:'active',scopes:['latihan-tester']};
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',mode:'live',agent:'openai'}}));
 await page.route('**/api/auth/register',r=>r.fulfill({status:202,json:{status:'active',message:'Pendaftaran berhasil. Silakan masuk; ruang latihan dan data contoh Anda sudah siap.'}}));
 await page.route('**/api/auth/login',r=>r.fulfill({json:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,profile}}));
 await page.route('**/api/contexts',r=>r.fulfill({json:[{context_id:'latihan-tester',name:'Pos Komando Latihan'}]}));
 await page.route('**/api/sessions',r=>r.fulfill({json:{session_id:'tester-session',context_id:'latihan-tester',created_at:new Date().toISOString()}}));
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:': keep-alive\n\n'}));
 await page.goto('/');
 await page.getByRole('button',{name:'Daftar akun',exact:true}).click();
 await page.getByLabel('Nama tampilan',{exact:true}).fill('Petugas Uji');
 await page.getByLabel('Email',{exact:true}).fill('tester@example.test');
 await page.getByLabel('Kata sandi',{exact:true}).fill('Uji12345');
 await page.getByRole('button',{name:'Daftar',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('ruang latihan dan data contoh Anda sudah siap');
 await page.getByLabel('Kata sandi',{exact:true}).fill('Uji12345');
 await page.getByRole('button',{name:'Masuk',exact:true}).click();
 await expect(page.getByLabel('Pos komando aktif')).toHaveValue('latihan-tester');
 await expect(page.getByRole('heading',{name:'Tugas petugas'})).toBeVisible();await page.getByRole('button',{name:'Laporan',exact:true}).click();await expect(page.getByLabel('Laporan atau pertanyaan Anda')).toBeVisible();
 await expect(page.getByRole('region',{name:'Bergabung ke ruang kerja'})).toHaveCount(0);
});
