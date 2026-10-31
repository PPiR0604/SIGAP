import {test,expect} from '@playwright/test';

test('summary, needs and status are separate panels with independent, persistent controls',async({page})=>{
 const records=[{batch_id:'a',report_id:'R1',shelter_name:'Posko A',village:'Desa A',total_people:10,male:4,female:6}];
 await page.route('**/api/sessions/*/recovery',r=>r.fulfill({json:{records,reviews:[],after_event_id:0,active_batch:null}}));
 await page.route('**/api/sessions/*/overview',r=>r.fulfill({json:{status:'ready',records,calculation:null}}));
 await page.route('**/api/sessions/*/events',r=>r.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'}));
 await page.goto('/?view=Laporan');if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 const summary=page.getByRole('region',{name:'Jumlah seluruh posko'}),needs=page.getByRole('region',{name:'Panel total kebutuhan'}),status=page.getByRole('region',{name:'Panel status pemeriksaan'});
 await expect(summary).toContainText('1 posko · 10 jiwa');await expect(needs).toBeVisible();await expect(status).toBeVisible();
 expect(await needs.evaluate(el=>el.previousElementSibling?.getAttribute('aria-label'))).toBe('Jumlah seluruh posko');expect(await status.evaluate(el=>el.previousElementSibling?.getAttribute('aria-label'))).toBe('Panel total kebutuhan');
 const needsToggle=needs.getByRole('button',{name:'Buka total kebutuhan'}),statusToggle=status.getByRole('button',{name:'Buka status pemeriksaan'});
 await needsToggle.click();await expect(page.getByRole('group',{name:'Kebutuhan seluruh posko'})).toBeVisible();await expect(statusToggle).toHaveAttribute('aria-expanded','false');
 await statusToggle.click();await expect(status.getByRole('img',{name:/Sebaran status/})).toBeVisible();await needs.getByRole('button',{name:'Ciutkan total kebutuhan'}).click();await expect(status.getByRole('img',{name:/Sebaran status/})).toBeVisible();await expect(page.locator('#report-needs-panel')).toBeHidden();
 await page.reload();if((page.viewportSize()?.width??1440)<=760)await page.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 await expect(page.getByRole('button',{name:'Buka total kebutuhan'})).toHaveAttribute('aria-expanded','false');await expect(page.getByRole('button',{name:'Ciutkan status pemeriksaan'})).toHaveAttribute('aria-expanded','true');
 for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
