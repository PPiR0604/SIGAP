import {test,expect} from '@playwright/test';

const admin={user_id:'11111111-1111-4111-8111-111111111111',display_name:'Admin Uji',organization_id:'org-fixture',role:'admin',status:'active',scopes:[]};
async function signIn(page:import('@playwright/test').Page,profile:object){
 await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',mode:'live',agent:'openai'}}));
 await page.route('**/api/auth/login',r=>r.fulfill({json:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,profile}}));
 await page.route('**/api/sessions',r=>r.fulfill({json:{session_id:'admin-session',context_id:'posko-uji',created_at:new Date().toISOString()}}));
 await page.route('**/api/sessions/*/recovery',r=>r.fulfill({json:{records:[],reviews:[],after_event_id:0,active_batch:null}}));
 await page.route('**/api/sessions/*/overview',r=>r.fulfill({json:{status:'empty',records:[],calculation:null}}));
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:': keep-alive\n\n'}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();await page.getByLabel('Email',{exact:true}).fill('user@example.test');await page.getByLabel('Kata sandi',{exact:true}).fill('Uji12345');await page.getByRole('button',{name:'Masuk',exact:true}).click();
}
test('admin can manage the first operation with explicit confirmation and preserve input after failure',async({page},testInfo)=>{
 let writes=0;
 await page.route('**/api/contexts',r=>r.fulfill({json:[]}));
 await page.route('**/api/admin/**',r=>{const path=new URL(r.request().url()).pathname;if(r.request().method()==='POST'){writes++;return r.fulfill({status:422,json:{error:{message:'ID operasi sudah digunakan.'}}});}return r.fulfill({json:path.endsWith('/command')?{name:'Organisasi Uji'}:path.endsWith('/users')?[admin]:[]});});
 await signIn(page,admin);await expect(page.getByRole('heading',{name:'Kelola ruang kerja'})).toBeVisible();await page.getByRole('button',{name:'Anggota',exact:true}).click();await expect(page.getByText('Admin Uji · Admin · Aktif')).toBeVisible();await page.getByRole('button',{name:'Operasi',exact:true}).click();
 await page.getByLabel('Nama pos komando',{exact:true}).fill('Posko Pengujian');await page.getByLabel('ID operasi',{exact:true}).fill('posko-uji');await page.getByRole('button',{name:'Tinjau operasi baru'}).click();expect(writes).toBe(0);await expect(page.getByRole('dialog')).toContainText('Posko Pengujian (posko-uji)');await page.getByRole('button',{name:'Kembali periksa',exact:true}).click();expect(writes).toBe(0);
 await page.getByRole('button',{name:'Tinjau operasi baru'}).click();await page.getByRole('button',{name:'Konfirmasi perubahan'}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('ID operasi sudah digunakan');expect(writes).toBe(1);await page.getByRole('button',{name:'Kembali periksa',exact:true}).click();await expect(page.getByLabel('Nama pos komando',{exact:true})).toHaveValue('Posko Pengujian');
 await page.screenshot({path:testInfo.outputPath('admin.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('viewer reads approved Markdown content and can refresh without operational controls',async({page})=>{
 let reads=0;await page.route('**/api/publications',r=>{reads++;return r.fulfill({json:[{id:'publication-fixture',context_id:'posko-uji',content:'# Buletin lapangan\n\n**Air bersih:** 100 liter\n\n| Posko | Jiwa |\n| --- | --- |\n| Uji | 10 |',content_sha256:'a'.repeat(64),approved_at:'2026-10-27T01:00:00Z'}]});});
 await signIn(page,{...admin,role:'viewer'});await expect(page.getByRole('heading',{name:'Buletin lapangan'})).toBeVisible();await expect(page.getByRole('table')).toContainText('Uji');await expect(page.getByRole('button',{name:'Kelola ruang kerja'})).toHaveCount(0);await expect(page.getByLabel('Laporan atau pertanyaan Anda')).toHaveCount(0);const beforeRefresh=reads;await page.getByRole('button',{name:'Perbarui publikasi'}).click();await expect.poll(()=>reads).toBe(beforeRefresh+1);
});
test('pending users request access only after submitting and never assign their own role',async({page})=>{
 let writes=0;await page.route('**/api/auth/join-requests',r=>{writes++;expect(r.request().postDataJSON()).toEqual({note:'Petugas lapangan pengujian'});return r.fulfill({status:202,json:{status:'pending'}});});
 await signIn(page,{...admin,role:null,status:'pending',organization_id:null});await expect(page.getByRole('region',{name:'Bergabung ke ruang kerja'})).toBeVisible();expect(writes).toBe(0);await page.getByLabel('Catatan untuk admin (opsional)').fill('Petugas lapangan pengujian');await page.getByRole('button',{name:'Kirim permintaan bergabung'}).click();await expect(page.getByRole('status')).toContainText('Permintaan terkirim');expect(writes).toBe(1);await expect(page.getByRole('button',{name:'Kirim permintaan bergabung'})).toBeDisabled();await expect(page.getByLabel('Peran',{exact:true})).toHaveCount(0);
});
test('member role and scopes are reviewed before the backend receives a change',async({page})=>{
 let payload:unknown;
 const member={...admin,user_id:'22222222-2222-4222-8222-222222222222',display_name:'Petugas Uji',role:'petugas',scopes:['posko-uji']};
 await page.route('**/api/contexts',r=>r.fulfill({json:[{context_id:'posko-uji',name:'Posko Pengujian'}]}));
 await page.route('**/api/admin/**',r=>{const path=new URL(r.request().url()).pathname;if(r.request().method()==='PATCH'){payload=r.request().postDataJSON();return r.fulfill({json:{...member,...payload as object}});}return r.fulfill({json:path.endsWith('/command')?{name:'Uji'}:path.endsWith('/users')?[admin,member]:[]});});
 await signIn(page,admin);await page.getByRole('button',{name:'Laporan',exact:true}).click();await page.getByLabel('Laporan atau pertanyaan Anda').fill('Draf yang harus tetap ada.');await page.getByRole('button',{name:'Kelola ruang kerja'}).click();await page.getByRole('button',{name:'Anggota',exact:true}).click();const editor=page.locator('details').filter({has:page.locator('summary',{hasText:'Petugas Uji'})});await editor.locator('summary').click();await editor.getByRole('combobox',{name:'Peran',exact:true}).selectOption('viewer');await editor.getByLabel('Posko Pengujian',{exact:true}).uncheck();await editor.getByRole('button',{name:'Tinjau perubahan akses'}).click();expect(payload).toBeUndefined();await expect(page.getByRole('dialog')).toContainText('Petugas → Viewer');await page.getByRole('button',{name:'Konfirmasi perubahan'}).click();await expect.poll(()=>payload).toEqual({role:'viewer',status:'active',scopes:[]});await expect(page.getByRole('status').filter({hasText:'Perubahan berhasil disimpan'})).toBeVisible();await page.getByRole('button',{name:'Kembali ke laporan'}).click();await expect(page.getByLabel('Laporan atau pertanyaan Anda')).toHaveValue('Draf yang harus tetap ada.');
});

test('admin publication checks exact server content and waits for confirmation of the originating batch',async({page})=>{
 const content='# Buletin yang disetujui\n\nPosko Uji membutuhkan air bersih.';const batch='a'.repeat(32);let changed=true,writes=0;
 await page.route('**/api/contexts',r=>r.fulfill({json:[{context_id:'posko-uji',name:'Posko Pengujian'}]}));
 await signIn(page,admin);
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:`id: 1\nevent: bulletin_ready\ndata: ${JSON.stringify({batch_id:batch,content})}\n\n`}));
 await page.route('**/api/batches/*',r=>r.fulfill({json:{batch_id:batch,bulletin:{content:changed?'Draf sudah berubah.':content}}}));
 const link={share_id:'c'.repeat(64),path:'/publikasi/'+'p'.repeat(43),approved_at:'2026-10-30T01:00:00Z'};let active=false;
 await page.route('**/api/contexts/*/publication-links',r=>r.fulfill({json:active?[{...link,batch_id:batch,active:true,source_version:'source-v1'}]:[]}));
 await page.route('**/api/batches/*/publication-link',r=>r.fulfill({json:{link:active?link:null}}));
 await page.route('**/api/batches/*/publication-preview',r=>r.fulfill({json:{review_id:'1'.repeat(32),review_sha256:'2'.repeat(64),data:{schema_version:'sigap-public-bulletin-v1',content,context_name:'Operasi Uji',source:{version:'source-v1',kind:'stored'},generated_at:null,calculation_available:false,records:[]}}}));
 await page.route('**/api/batches/*/publication/public',r=>{writes++;active=true;expect(r.request().url()).toContain(`/batches/${batch}/publication/public`);expect(r.request().postDataJSON()).toEqual({review_id:'1'.repeat(32),review_sha256:'2'.repeat(64),public_acknowledged:true});return r.fulfill({status:503,json:{error:{code:'REQUEST_FAILED'}}});});
 await page.getByRole('navigation').getByRole('button',{name:'Buletin',exact:true}).click();await page.getByRole('button',{name:'Tinjau publikasi',exact:true}).click();await expect(page.getByRole('region',{name:'Persetujuan publikasi'}).getByRole('alert')).toContainText('Draf berubah');expect(writes).toBe(0);
 changed=false;await page.getByRole('button',{name:'Tinjau publikasi',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Tinjau halaman publik'});await expect(dialog).toContainText('Posko Uji membutuhkan air bersih.');expect(writes).toBe(0);
 await expect(dialog.getByRole('button',{name:'Setujui & buat tautan'})).toBeDisabled();await dialog.getByRole('checkbox',{name:/Saya menyetujui isi buletin/}).check();await dialog.getByRole('button',{name:'Setujui & buat tautan'}).click();
 await expect(dialog.getByRole('alert')).toContainText('Status publikasi belum dapat dipastikan');expect(writes).toBe(1);await dialog.getByRole('button',{name:'Periksa status tautan',exact:true}).click();
 await expect(page.getByLabel('Tautan publik',{exact:true})).toHaveValue(new URL(link.path,'http://127.0.0.1:5183').href);expect(writes).toBe(1);await expect(page.getByRole('list',{name:'Alur buletin'})).toContainText('Disetujui admin');await expect(page.getByRole('article',{name:'Isi draf buletin'})).toContainText('Publikasi disetujui admin');
});

test('admin can revoke an earlier public link without recreating its bulletin draft',async({page})=>{
 let active=true,deletes=0;const shareId='9'.repeat(64),batch='8'.repeat(32);
 await page.route('**/api/contexts',r=>r.fulfill({json:[{context_id:'posko-uji',name:'Posko Pengujian'}]}));
 await page.route('**/api/contexts/*/publication-links',r=>r.fulfill({json:[{share_id:shareId,batch_id:batch,path:'/publikasi/'+'p'.repeat(43),approved_at:'2026-10-30T01:00:00Z',active,source_version:'versi-lama'}]}));
 await page.route('**/api/batches/*/publication-link/*',r=>{expect(r.request().method()).toBe('DELETE');expect(r.request().url()).toContain(batch);deletes++;active=false;return r.fulfill({status:204});});
 await signIn(page,admin);await page.getByRole('navigation').getByRole('button',{name:'Buletin',exact:true}).click();
 const history=page.getByRole('region',{name:'Riwayat tautan publik'});await expect(history).toContainText('versi-lama');
 await history.getByRole('button',{name:'Nonaktifkan',exact:true}).click();expect(deletes).toBe(0);await history.getByRole('button',{name:'Batal',exact:true}).click();expect(deletes).toBe(0);
 await history.getByRole('button',{name:'Nonaktifkan',exact:true}).click();await history.getByRole('button',{name:'Ya, nonaktifkan',exact:true}).click();
 await expect(history).toContainText('Dinonaktifkan');expect(deletes).toBe(1);await expect(history.getByRole('link',{name:'Buka publikasi'})).toHaveCount(0);
});
