import {test,expect,composer} from './fixtures';

test('pratinjau dapat diciutkan tanpa menghapus draf, lalu dibuka dengan keyboard',async({app})=>{
 await app.setViewportSize({width:1440,height:900});
 const panel=app.getByRole('region',{name:'Pratinjau rekap',exact:true});
 const button=panel.getByRole('button',{name:'Ciutkan',exact:true});
 const chat=app.getByRole('region',{name:'Percakapan laporan'});
 await composer(app).fill('Draf belum dikirim');
 const before=(await chat.boundingBox())!.width;
 await button.click();
 await expect.poll(()=>app.locator('.laporan-workspace').evaluate(el=>el.getAnimations().some(a=>(a as CSSTransition).transitionProperty==='grid-template-columns'))).toBe(true);
 await expect(panel.getByRole('button',{name:'Buka',exact:true})).toHaveAttribute('aria-expanded','false');
 await expect(app.locator('#preview-panel-content')).toBeHidden();
 await expect.poll(async()=>(await chat.boundingBox())!.width).toBeGreaterThan(before);
 await expect(composer(app)).toHaveValue('Draf belum dikirim');
 const open=panel.getByRole('button',{name:'Buka',exact:true});await open.focus();await open.press('Enter');
 await expect(panel.getByRole('button',{name:'Ciutkan',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect(app.locator('#preview-panel-content')).toBeVisible();
 await app.setViewportSize({width:320,height:800});
 await app.emulateMedia({reducedMotion:'reduce'});
 await app.getByRole('button',{name:/Hasil pemeriksaan/}).click();
 await panel.getByRole('button',{name:'Ciutkan',exact:true}).click();
 expect(await app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await panel.getByRole('button',{name:'Buka',exact:true}).click();
 await expect(app.locator('#preview-panel-content')).toHaveCSS('animation-name','none');
 await app.getByRole('button',{name:'Tulis laporan',exact:true}).click();await expect(composer(app)).toHaveValue('Draf belum dikirim');
});

test('riwayat chat dapat dibuka cepat setelah diciutkan tanpa menghilangkan draf',async({app})=>{
 await composer(app).fill('Draf tetap tersedia');
 const close=app.getByRole('button',{name:'Ciutkan percakapan'});
 await close.click();
 const open=app.getByRole('button',{name:'Buka percakapan'});
 await expect(open).toHaveAttribute('aria-expanded','false');
 await expect(app.locator('#chat-history-panel')).toHaveAttribute('inert','');
 await open.click();
 await expect(close).toHaveAttribute('aria-expanded','true');
 await expect(app.getByRole('log',{name:'Riwayat percakapan'})).toBeVisible();
 await expect(composer(app)).toHaveValue('Draf tetap tersedia');
 await app.emulateMedia({reducedMotion:'reduce'});
 await close.click();
 await expect(app.locator('#chat-history-panel')).toHaveCSS('transition-duration','0s');
});
