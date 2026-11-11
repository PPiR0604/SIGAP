import {test,expect,recapRows} from './fixtures';

test('failed row import withdraws its approval and preserves stored data and unrelated drafts',async({page})=>{
 let seq=0;const events:{id:number;body:string}[]=[];
 const emit=(event:string,data:any)=>{const id=++seq;events.push({id,body:`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`});};
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
 await page.route('**/api/sessions/*/events',route=>route.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(route.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
 let decisions=0;await page.route('**/api/batches/*/decisions',route=>{decisions++;return route.fulfill({status:422,json:{error:{code:'INVALID_BATCH_STATUS'}}});});
 await page.goto('/?view=Rekap');await page.getByRole('navigation').getByRole('button',{name:'Rekap',exact:true}).click();
 emit('stored_rekap_ready',{records:[{report_id:'R001',batch_id:'stored',shelter_name:'Posko Tersimpan',village:'Desa Asal',total_people:98}]});
 await expect(recapRows(page)).toHaveCount(1);
 const failed='f'.repeat(32),other='b'.repeat(32);
 const preview=(batch:string,name:string)=>({batch_id:batch,snapshot_id:batch,snapshot_sha256:'a'.repeat(64),records:[{report_id:'R001',batch_id:'source-'+batch,shelter_name:name,village:'Desa Uji',total_people:10}]});
 emit('preview_ready',preview(failed,'Posko Draf Gagal'));emit('preview_ready',preview(other,'Posko Draf Lain'));
 emit('processing_completed',{batch_id:other});
 const picker=page.getByLabel('Perubahan yang akan disimpan');
 await expect(picker.locator('option')).toHaveCount(2);await expect(recapRows(page)).toHaveCount(3);
 await picker.selectOption(failed);await page.getByRole('button',{name:'Tinjau & setujui',exact:true}).click();
 await expect(page.locator('.approval-scope')).toContainText('Posko Draf Gagal');
 emit('error',{batch_id:failed,code:'ROW_PREPARATION_FAILED',message:'Pembuatan draf laporan belum lengkap. Impor perlu dicoba ulang.'});
 await expect(page.locator('.approval-scope')).toHaveCount(0);await expect(picker.locator('option')).toHaveCount(1);await expect(picker).toHaveValue(other);
 await expect(recapRows(page)).toHaveCount(2);await expect(page.getByRole('button',{name:'Posko Draf Gagal',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Posko Tersimpan',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Posko Draf Lain',exact:true})).toBeVisible();
 expect(decisions).toBe(0);
});
