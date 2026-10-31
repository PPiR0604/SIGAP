import {test,expect,type Page} from '@playwright/test';

const a={batch_id:'stored-a',report_id:'R001',shelter_name:'Posko A',village:'Desa A',total_people:100,male:40,female:60,elderly:4,disability:0,urgent_needs:['air bersih']};
const b={...a,batch_id:'stored-b',report_id:'R002',shelter_name:'Posko B',village:'Desa B'};
async function workspace(page:Page,records:any[]=[a,b]){
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  let next=0;const events:{id:number;body:string}[]=[];
  const emit=(type:string,data:unknown)=>{const id=++next;events.push({id,body:`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`});};
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
  emit('stored_rekap_ready',{records});
  await page.goto('/?view=Laporan');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();
  await expect(page.getByLabel('Pilih posko pratinjau')).toHaveCount(records.length?1:0);
  return emit;
}

test('chat mengikuti pesan terbaru dan mempertahankan posisi saat membaca pesan lama',async({page})=>{
  const emit=await workspace(page);
  expect(await page.getByRole('textbox',{name:'Laporan atau pertanyaan Anda'}).evaluate(el=>getComputedStyle(el).fontSize)).toBe('16px');
  for(let i=0;i<14;i++)emit('assistant_message',{text:`Pesan ${i+1}\n\n${'Laporan kebutuhan posko untuk pemeriksaan. '.repeat(8)}`});
  const log=page.getByRole('log',{name:'Riwayat percakapan'});
  await expect(log).toContainText('Pesan 14');
  const atBottom=()=>log.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<48);
  await expect.poll(atBottom).toBe(true);
  await log.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  emit('assistant_message',{text:'Pesan lanjutan saat petugas membaca riwayat.'});
  await expect(log).toContainText('Pesan lanjutan saat petugas membaca riwayat.');
  expect(await log.evaluate(el=>el.scrollTop)).toBeLessThan(10);
  await page.getByRole('button',{name:'Pesan terbaru',exact:true}).click();
  await expect.poll(atBottom).toBe(true);
  await expect(page.getByRole('button',{name:'Pesan terbaru',exact:true})).toHaveCount(0);
});

test('posko terpilih tetap sama ketika koreksi mengganti ID kandidat dan nama desa',async({page})=>{
  const emit=await workspace(page);
  await page.getByLabel('Pilih posko pratinjau').selectOption({label:'Posko B · Desa B'});
  emit('preview_ready',{batch_id:'c'.repeat(32),snapshot_id:'d'.repeat(32),records:[{...b,report_id:'R099',batch_id:'candidate-b',shelter_name:'Posko B Baru',village:'Desa Baru',update_target:{batch_id:b.batch_id,report_id:b.report_id}}]});
  const preview=page.getByRole('region',{name:'Pratinjau rekap',exact:true});
  await expect(preview.getByRole('heading',{name:'Posko B Baru',exact:true})).toBeVisible();
  await expect(page.getByLabel('Pilih posko pratinjau').locator('option:checked')).toHaveText('Posko B Baru · Desa Baru');
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(2);
});

test('pintasan pemeriksaan menampilkan seluruh posko bermasalah meskipun filter lama aktif',async({page})=>{
  await workspace(page,[a,{...b,total_people:null,male:null,female:null},{...a,batch_id:'stored-c',report_id:'R003',shelter_name:'Posko C',village:'Desa C',total_people:101}]);
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await page.getByLabel('Cari posko atau desa').fill('Posko A');
  await page.getByLabel('Filter desa').selectOption('Desa A');
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:'2 posko perlu diperiksa. Periksa',exact:true}).click();
  await expect(page.getByLabel('Cari posko atau desa')).toHaveValue('');
  await expect(page.getByLabel('Filter desa')).toHaveValue('');
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody')).toContainText('Posko B');
  await expect(page.getByRole('region',{name:'Tabel rekap posko',exact:true}).locator('tbody')).toContainText('Posko C');
});

test('kegagalan memuat penugasan akun bisa dicoba ulang tanpa mendaftar atau login lagi',async({page})=>{
  const profile={user_id:'fixture-user',display_name:'Petugas Uji',organization_id:'fixture-org',role:'petugas',status:'active',scopes:['komando-uji']};
  let attempts=0;
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',backend:'ready',agent:'openai',mode:'live'}}));
  await page.route('**/api/auth/login',r=>r.fulfill({json:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,profile}}));
  await page.route('**/api/auth/me',r=>r.fulfill({json:{profile}}));
  await page.route('**/api/contexts',r=>++attempts===1?r.fulfill({status:503,json:{error:{message:'Penugasan belum dapat dimuat.'}}}):r.fulfill({json:[{context_id:'komando-uji',name:'Komando Uji'}]}));
  await page.route('**/api/sessions',r=>r.fulfill({status:201,json:{session_id:'fixture-session'}}));
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'}));
  await page.goto('/?view=Laporan');
  await expect(page.getByRole('heading',{name:'Masuk ke SIGAP',exact:true})).toBeVisible();
  await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');
  await page.getByLabel('Kata sandi',{exact:true}).fill('Uji12345');
  await page.getByRole('button',{name:'Masuk',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Penugasan belum dapat dimuat.');
  await page.getByRole('button',{name:'Periksa akses lagi',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Navigasi utama'})).toBeVisible();
  await expect(page.getByLabel('Pos komando aktif')).toHaveValue('komando-uji');
  expect(attempts).toBe(2);
});

test('rekap lengkap tidak diberi judul atau peringatan konflik parsial',async({page})=>{
  let decisions=0;
  await page.route('**/api/batches/*/decisions',r=>{decisions++;return r.fulfill({status:202,json:{success:true,status:'saving'}});});
  const emit=await workspace(page);
  emit('preview_ready',{batch_id:'e'.repeat(32),snapshot_id:'f'.repeat(32),records:[a]});
  await page.getByRole('button',{name:'Tinjau & setujui',exact:true}).click();
  const approval=page.getByRole('dialog',{name:'Tinjau persetujuan'});
  await expect(approval.getByRole('heading',{name:'Setujui rekap?',exact:true})).toBeVisible();
  await expect(approval).not.toContainText('memuat konflik angka');
  await expect(approval.getByLabel(/Saya memahami rekap masih parsial/)).toHaveCount(0);
  await expect(approval.getByLabel(/Saya menyetujui keputusan penyimpanan/)).toBeVisible();
  await approval.getByRole('button',{name:'Konfirmasi persetujuan'}).click();
  await expect(approval.getByRole('alert')).toHaveText('Berikan persetujuan eksplisit atas pratinjau ini.');
  expect(decisions).toBe(0);
  await approval.getByLabel(/Saya menyetujui keputusan penyimpanan/).check();
  await approval.getByRole('button',{name:'Konfirmasi persetujuan'}).click();
  await expect.poll(()=>decisions).toBe(1);
});
