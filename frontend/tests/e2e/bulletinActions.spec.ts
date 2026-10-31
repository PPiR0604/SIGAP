import {test,expect} from '@playwright/test';

test('one copy action, busy guards, draft printing and collapsible source details',async({page,context},testInfo)=>{
 await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
 let id=0;const events:{id:number;body:string}[]=[];
 const emit=(type:string,data:unknown)=>{const next=++id;events.push({id:next,body:`id: ${next}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`});};
 const text='# Draf kebutuhan\n\n**DRAF — periksa sebelum dibagikan.**\n\nAir bersih untuk Posko Uji.\n\nSumber: laporan sintetis.';
 emit('stored_rekap_ready',{records:[{batch_id:'stored',report_id:'R001',shelter_name:'Posko Uji',village:'Desa Uji',total_people:10,male:4,female:6,urgent_needs:['air bersih']}]});
 emit('bulletin_ready',{content:text,source_metadata:{snapshot_id:'source-version-1',kind:'stored',generated_at:'2026-10-29T01:00:00Z',records:[{batch_id:'stored',report_id:'R001',shelter_name:'Posko Uji',village:'Desa Uji',total_people:10,male:4,female:6}]}});
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:events.filter(e=>e.id>Number(r.request().headers()['last-event-id']||0)).map(e=>e.body).join('')||': keepalive\n\n'}));
 await page.route('**/api/sessions/*/messages',r=>r.fulfill({status:202,json:{batch_id:'bulletin-refresh',pii_summary:{totalRedacted:0}}}));
 await page.goto('/');await expect(page.getByRole('button',{name:'Backend Mock',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Buletin',exact:true}).click();
 const copy=page.getByRole('button',{name:'Salin draf',exact:true}),print=page.getByRole('button',{name:'Cetak draf',exact:true});
 await expect(copy).toHaveCount(1);await expect(copy).toBeEnabled();await context.grantPermissions(['clipboard-read','clipboard-write']);await copy.click();
 expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe(text);
 await page.evaluate(()=>{(window as any).printCalls=0;window.print=()=>{(window as any).printCalls++;};});
 await page.getByRole('button',{name:'Susun ulang draf',exact:true}).click();await expect(copy).toBeDisabled();await expect(print).toBeDisabled();await expect(page.getByRole('article',{name:'Isi draf buletin'})).toContainText('Air bersih untuk Posko Uji');
 emit('processing_completed',{batch_id:'bulletin-refresh'});await expect(print).toBeEnabled();await print.click();expect(await page.evaluate(()=>(window as any).printCalls)).toBe(1);
 const meta=page.getByLabel('Rincian sumber buletin',{exact:true});await expect(meta).not.toHaveAttribute('open','');await meta.locator('summary').focus();await meta.locator('summary').press('Enter');await expect(meta).toContainText('10 jiwa terdata');
 await meta.locator('summary').press('Enter');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('buletin-actions.png'),fullPage:true});
});
