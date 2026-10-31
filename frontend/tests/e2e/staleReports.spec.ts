import {test,expect} from '@playwright/test';
test('old, recent and unknown report times remain distinct and old shelter opens its detail',async({page})=>{
 await page.clock.install({time:new Date('2026-10-30T06:00:00Z')});
 const records=[{batch_id:'a',report_id:'R1',shelter_name:'Posko Lama',village:'A',total_people:10,reported_at:'2026-10-28 08:00'},{batch_id:'b',report_id:'R2',shelter_name:'Posko Baru',village:'B',total_people:12,reported_at:'2026-10-30 12:00'},{batch_id:'c',report_id:'R3',shelter_name:'Posko Tanpa Waktu',village:'C',total_people:5,updated_at:'2026-10-01 08:00'}];
 await page.route('**/api/sessions/*/recovery',r=>r.fulfill({json:{records,reviews:[],after_event_id:0,active_batch:null}}));
 await page.route('**/api/sessions/*/overview',r=>r.fulfill({json:{status:'ready',records,calculation:null}}));
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'}));
 await page.goto('/?view=Laporan');if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 const panel=page.getByRole('region',{name:'Pembaruan laporan posko'});await expect(panel).toContainText('1 posko lebih dari 24 jam');await expect(panel).toContainText('Posko Lama');await expect(panel).not.toContainText('Posko Baru');
 await panel.locator('summary').click();await expect(panel).toContainText('Posko Tanpa Waktu');
 await panel.getByRole('button',{name:'Posko Lama'}).click();await expect(page.getByRole('region',{name:'Halaman klarifikasi posko'})).toContainText('Posko Lama');
});
