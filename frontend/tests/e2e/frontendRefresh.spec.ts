import {test,expect,type Page} from '@playwright/test';
import {createPreview} from './fixtures';

const frame=(event:string,data:unknown,id=1)=>`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const record=(index:number)=>({batch_id:`stored-${index}`,report_id:`R${String(index+1).padStart(3,'0')}`,shelter_name:`Posko Uji ${index+1}`,village:`Desa ${index%3}`,total_people:index,male:index,female:0,elderly:0,disability:0,urgent_needs:['air bersih']});
test.beforeEach(async({page})=>{await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());});

test('R001, nol jiwa, pergantian posko, dan kartu pratinjau memakai data server',async({page})=>{
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:frame('stored_rekap_ready',{records:[record(0),record(1)]})}));
 await page.goto('/?view=Laporan');const preview=page.getByRole('region',{name:'Pratinjau rekap',exact:true});
 await expect(preview.getByRole('heading',{name:'Posko Uji 1',exact:true})).toBeVisible();
 await expect(preview.locator('.detail-grid').first()).toContainText('0');
 const details=preview.locator('.preview-details');
 await expect(details.getByText('Kebutuhan hasil perhitungan')).toBeHidden();
 await details.locator('summary').click();
 await expect(details.getByText('Kebutuhan hasil perhitungan')).toBeVisible();
 await expect(details.getByText('Disabilitas',{exact:true})).toBeVisible();
 await expect(page.getByText('Posko Darurat Cimalaka',{exact:true})).toHaveCount(0);
 await expect(page.getByText('186 karakter',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Tinjau & setujui'})).toHaveCount(0);await expect(page.getByText('Tidak ada perubahan menunggu persetujuan untuk posko ini.',{exact:true})).toBeVisible();
 await preview.getByLabel('Pilih posko pratinjau').selectOption({label:'Posko Uji 2 · Desa 1'});
 await preview.getByRole('button',{name:'Periksa & klarifikasi Posko Uji 2'}).click();
 await expect(page.getByRole('dialog').getByRole('heading',{name:'Posko Uji 2',exact:true})).toBeVisible();
});

test('pagination mencapai halaman kelima dan filter mengembalikan halaman valid',async({page})=>{
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:frame('stored_rekap_ready',{records:Array.from({length:41},(_,i)=>record(i))})}));
 await page.goto('/?view=Laporan');await page.getByRole('button',{name:'Rekap',exact:true}).click();
 await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(10);
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'Berikutnya',exact:true}).click();
 await expect(page.getByText('Halaman 5 dari 5',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(1);
 await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody')).toContainText('Posko Uji 41');
 await expect(page.getByRole('button',{name:'Berikutnya',exact:true})).toBeDisabled();
 await page.getByLabel('Cari posko atau desa').fill('Posko Uji 41');
 await expect(page.getByText('Halaman 1 dari 1',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(1);
 await page.getByLabel('Cari posko atau desa').fill('tidak ditemukan');
 await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(0);
 await page.getByRole('button',{name:'Reset filter'}).click();await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(10);
});

const profile={user_id:'test-user',organization_id:'test-org',role:'petugas',status:'active',scopes:['komando-uji'],display_name:'Petugas Uji'};
test('tabel tidak memperlebar viewport dan tombol persetujuan tetap bisa diklik',async({page})=>{
 await page.goto('/?view=Laporan');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();
 await createPreview(page);
 const viewport=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,inner:innerWidth}));
 expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width+1);
 expect(viewport.inner).toBeLessThanOrEqual(viewport.width+1);
 await page.getByRole('button',{name:'Tinjau & setujui'}).click();
 await expect(page.getByRole('dialog',{name:'Tinjau persetujuan'})).toBeVisible();
});
const session={access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,profile};
async function authBackend(page:Page){
 await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',agent:'openai',mode:'live',storage:'unverified',write_enabled:true}}));
 await page.route('**/api/contexts',r=>r.fulfill({json:[{context_id:'komando-uji',name:'Komando Uji'}]}));
 await page.route('**/api/sessions',r=>r.fulfill({status:201,json:{session_id:'session-uji',context_id:'komando-uji'}}));
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'}));
}
test('login memakai akun dan scope server, logout membersihkan ruang kerja',async({page})=>{
 await authBackend(page);let credentials:any,scope:any;
 await page.route('**/api/auth/login',r=>{credentials=r.request().postDataJSON();return r.fulfill({json:session});});
 await page.route('**/api/auth/logout',r=>r.fulfill({status:204}));
 page.on('request',r=>{if(r.url().endsWith('/api/sessions'))scope=r.postDataJSON();});
 await page.goto('/?view=Laporan');await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
 await page.getByLabel('Email',{exact:true}).fill('petugas@example.test');await page.getByLabel('Kata sandi',{exact:true}).fill('password-uji-123');await page.getByRole('button',{name:'Masuk',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Navigasi utama'})).toBeVisible();
 expect(credentials).toEqual({email:'petugas@example.test',password:'password-uji-123'});
 await expect.poll(()=>scope?.context_id).toBe('komando-uji');
 await expect(page.getByRole('button',{name:'Petugas Uji',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('sigap_token'))).toBeNull();
 await page.getByRole('button',{name:'Keluar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem('sigap_auth_session'))).toBeNull();
 await expect(page.getByRole('navigation')).toHaveCount(0);
});
test('login ditolak mempertahankan formulir tanpa membuka data',async({page})=>{
 await authBackend(page);await page.route('**/api/auth/login',r=>r.fulfill({status:401,json:{error:{message:'Email/password tidak valid atau akun belum dapat login.'}}}));
 await page.goto('/?view=Laporan');await expect(page.getByRole('heading',{name:'Masuk ke SIGAP'})).toBeVisible();await page.getByLabel('Email',{exact:true}).fill('petugas@example.test');await page.getByLabel('Kata sandi',{exact:true}).fill('password-uji-salah');await page.getByRole('button',{name:'Masuk',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Email/password tidak valid');await expect(page.getByRole('navigation')).toHaveCount(0);await expect(page.getByRole('button',{name:'Masuk',exact:true})).toBeEnabled();
});
test('token kedaluwarsa disegarkan sebelum membuat sesi dan akun pending tetap dibatasi',async({page})=>{
 await authBackend(page);let refreshes=0,contextReads=0;
 await page.route('**/api/contexts',r=>{contextReads++;return r.fulfill({json:[{context_id:'komando-uji',name:'Komando Uji'}]});});
 await page.addInitScript(s=>sessionStorage.setItem('sigap_auth_session',JSON.stringify(s)),{...session,expires_at:1});
 await page.route('**/api/auth/refresh',r=>{refreshes++;return r.fulfill({json:{...session,profile:{...profile,status:'pending',role:null}}});});
 await page.route('**/api/auth/me',r=>r.fulfill({json:{profile:{...profile,status:'pending',role:null}}}));
 await page.goto('/?view=Laporan');await expect(page.getByText('Akses operasional menunggu aktivasi dan penugasan admin.',{exact:true})).toBeVisible();expect(refreshes).toBe(1);await expect(page.getByRole('navigation')).toHaveCount(0);
 await page.getByRole('button',{name:'Periksa akses lagi',exact:true}).click();
 await expect(page.getByText('Akses operasional menunggu aktivasi dan penugasan admin.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Periksa akses lagi',exact:true})).toBeEnabled();
 await expect(page.getByRole('navigation')).toHaveCount(0);expect(contextReads).toBe(0);
});
