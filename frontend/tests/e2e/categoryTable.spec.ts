import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const needs=[['air bersih','beras','obat'],['air bersih','beras','obat'],['air bersih','beras','obat'],['air bersih','beras','sabun'],['air bersih','terpal','sabun'],['air bersih'],[],[],[]];
const records=needs.map((urgent_needs,i)=>({batch_id:`stored-${i}`,report_id:`R${i+1}`,shelter_name:`Posko Uji ${i+1}`,village:`Desa ${i%2}`,total_people:100,male:40,female:60,elderly:4,disability:0,urgent_needs}));
async function workspace(page:Page,initial:Record<string,unknown>[]=records){
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  let next=0;const events:{id:number;body:string}[]=[];
  const emit=(records:Record<string,unknown>[])=>{const id=++next;events.push({id,body:`id: ${id}\nevent: stored_rekap_ready\ndata: ${JSON.stringify({records})}\n\n`});};
  await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
  emit(initial);await page.goto('/');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  return emit;
}
const summary=(page:Page)=>page.getByRole('region',{name:'Kebutuhan yang dilaporkan',exact:true});
const recap=(page:Page)=>page.getByRole('region',{name:'Tabel rekap posko',exact:true});

test('tabel kebutuhan menggunakan penyebut posko, urutan jumlah, dan aksi yang terlihat',async({page},info)=>{
  if(info.project.name.startsWith('mobile'))await page.setViewportSize({width:320,height:812});
  await workspace(page);
  const card=summary(page);
  await expect(card).toContainText('9 posko dalam rekap');
  await expect(card.getByRole('rowheader')).toHaveText(['Air bersih','Pangan','Medis','Sanitasi','Tenda & hunian','Lainnya']);
  for(const [name,count] of [['Air bersih',6],['Pangan',4],['Medis',3],['Sanitasi',2],['Tenda & hunian',1],['Lainnya',0]] as const){
    const row=card.getByRole('row').filter({has:page.getByRole('rowheader',{name,exact:true})});
    await expect(row.getByRole('cell',{name:`${count} dari 9 posko`,exact:true})).toHaveText(`${count} dari 9`);
    if(count)await expect(row.getByRole('button',{name:`Lihat ${count} posko yang melaporkan ${name}`,exact:true})).toHaveText('Lihat posko');
    else{await expect(row.getByRole('button')).toHaveCount(0);await expect(row).toContainText('Belum dilaporkan');}
  }
  await expect(card).not.toContainText('%');
  const gap=await card.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Tenda & hunian',exact:true})}).evaluate(row=>{
    const label=document.createRange(),value=document.createRange();label.selectNodeContents(row.children[0]);value.selectNodeContents(row.children[1]);
    return value.getBoundingClientRect().left-label.getBoundingClientRect().right;
  });
  expect(gap).toBeGreaterThanOrEqual(8);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await card.screenshot({path:info.outputPath('tabel-dan-aksi.png'),style:'.app-header,.toast {opacity:0!important;}'});
});

test('aksi keyboard membuka posko sesuai kategori, fokus hasil, CSV, detail, dan hapus filter',async({page})=>{
  await workspace(page);let writes=0;page.on('request',r=>{if(r.url().endsWith('/decisions'))writes++;});
  await page.getByLabel('Cari posko atau desa').fill('tidak cocok');
  await page.getByLabel('Filter desa').selectOption('Desa 1');
  await page.getByLabel('Filter status').selectOption('Parsial');
  await page.getByRole('group',{name:'Jenis rekap'}).getByRole('button',{name:'Kebutuhan',exact:true}).click();
  const action=summary(page).getByRole('button',{name:'Lihat 6 posko yang melaporkan Air bersih',exact:true});
  await action.focus();await action.press('Enter');
  await expect(page.getByLabel('Cari posko atau desa')).toHaveValue('');
  await expect(page.getByLabel('Filter desa')).toHaveValue('');
  await expect(page.getByLabel('Filter status')).toHaveValue('Semua status');
  await expect(page.getByRole('group',{name:'Jenis rekap'}).getByRole('button',{name:'Posko',exact:true})).toHaveClass('selected');
  await expect(recap(page).locator('tbody tr')).toHaveCount(6);
  const results=page.getByLabel('Hasil filter rekap',{exact:true});
  await expect(results).toBeFocused();await expect(results).toContainText('Air bersih · 6 posko ditampilkan');
  const positions=await page.evaluate(()=>({anchor:document.querySelector('.recap-filter-summary')!.getBoundingClientRect().top,header:document.querySelector('.app-header')!.getBoundingClientRect().bottom}));
  expect(positions.anchor).toBeGreaterThanOrEqual(positions.header-1);
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Unduh CSV',exact:true}).click();
  const file=await downloaded;const csv=await readFile((await file.path())!,'utf8');
  expect(csv).toContain('Posko Uji 1');expect(csv).toContain('Posko Uji 6');expect(csv).not.toContain('Posko Uji 7');
  await recap(page).getByRole('button',{name:'Posko Uji 1',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Posko Uji 1',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Tutup dialog',exact:true}).click();
  await page.getByRole('button',{name:'Hapus filter kebutuhan',exact:true}).click();
  await expect(recap(page).locator('tbody tr')).toHaveCount(9);await expect(action).toHaveAttribute('aria-pressed','false');
  expect(writes).toBe(0);
});

test('filter mengikuti pembaruan kebutuhan dan pintasan pemeriksaan tidak membawa kategori lama',async({page})=>{
  const source=records.map((r,i)=>i===8?{...r,total_people:101}:r);
  const emit=await workspace(page,source);
  await summary(page).getByRole('button',{name:'Lihat 6 posko yang melaporkan Air bersih',exact:true}).click();
  await expect(recap(page).locator('tbody tr')).toHaveCount(6);
  emit(source.map((r,i)=>i===0?{...r,urgent_needs:['beras','obat']}:r));
  await expect(summary(page).getByRole('button',{name:'Lihat 5 posko yang melaporkan Air bersih',exact:true})).toBeVisible();
  await expect(recap(page).locator('tbody tr')).toHaveCount(5);
  await page.getByRole('button',{name:'1 posko perlu diperiksa. Periksa',exact:true}).click();
  await expect(page.getByRole('button',{name:'Hapus filter kebutuhan',exact:true})).toHaveCount(0);
  await expect(recap(page).locator('tbody tr')).toHaveCount(1);
  await expect(recap(page)).toContainText('Posko Uji 9');
});

test('kategori lain cocok dengan laporan sebenarnya dan hasil kosong dapat dipulihkan',async({page})=>{
  const emit=await workspace(page,[{...records[0],urgent_needs:['genset']},{...records[1],urgent_needs:['air bersih','air mineral']}]);
  await summary(page).getByRole('button',{name:'Lihat 1 posko yang melaporkan Lainnya',exact:true}).click();
  await expect(recap(page).locator('tbody tr')).toHaveCount(1);await expect(recap(page)).toContainText('genset');
  emit([]);
  await expect(summary(page)).toContainText('0 posko dalam rekap');
  await expect(summary(page).getByRole('button')).toHaveCount(0);
  await expect(summary(page)).not.toContainText('0 dari 0');
  await expect(recap(page).locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button',{name:'Hapus filter kebutuhan',exact:true}).click();
  await expect(page.getByLabel('Hasil filter rekap',{exact:true})).toContainText('0 dari 0 posko ditampilkan');
});

test('jumlah kategori dan CSV meliputi seluruh halaman hasil',async({page})=>{
  const source=Array.from({length:17},(_,i)=>({...records[0],batch_id:`multi-${i}`,report_id:`R${i+1}`,shelter_name:`Posko Halaman ${i+1}`,urgent_needs:i<15?['air bersih']:['obat']}));
  await workspace(page,source);
  await summary(page).getByRole('button',{name:'Lihat 15 posko yang melaporkan Air bersih',exact:true}).click();
  await expect(recap(page).locator('tbody tr')).toHaveCount(10);
  await page.locator('.functional-pagination').getByRole('button',{name:'Berikutnya',exact:true}).click();
  await expect(recap(page).locator('tbody tr')).toHaveCount(5);await expect(recap(page)).toContainText('Posko Halaman 15');
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Unduh CSV',exact:true}).click();
  const csv=await readFile((await (await downloaded).path())!,'utf8');
  expect(csv).toContain('Posko Halaman 1,');expect(csv).toContain('Posko Halaman 15,');expect(csv).not.toContain('Posko Halaman 16,');
});
