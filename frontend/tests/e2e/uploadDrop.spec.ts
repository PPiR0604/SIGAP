import {test,expect,composer} from './fixtures';

test('diagram preference survives navigation and empty preview does not show a candidate version',async({app})=>{
 await expect(app.locator('.functional-extraction')).not.toContainText('kandidat versi');await expect(app.locator('.functional-extraction').getByRole('button',{name:'Tinjau & setujui'})).toHaveCount(0);
 const showPanel=async()=>{if((app.viewportSize()?.width??1440)<=760)await app.getByRole('button',{name:/Hasil pemeriksaan/}).click();};await showPanel();
 const panel=()=>app.getByRole('region',{name:'Ringkasan seluruh posko'});await panel().getByRole('button',{name:'Buka total kebutuhan'}).click();await app.getByRole('button',{name:'Rekap',exact:true}).click();await app.getByRole('button',{name:'Laporan',exact:true}).click();await showPanel();await expect(panel().getByRole('button',{name:'Ciutkan total kebutuhan'})).toHaveAttribute('aria-expanded','true');await panel().getByRole('button',{name:'Ciutkan total kebutuhan'}).click();await app.getByRole('button',{name:'Rekap',exact:true}).click();await app.getByRole('button',{name:'Laporan',exact:true}).click();await showPanel();await expect(panel().getByRole('button',{name:'Buka total kebutuhan'})).toHaveAttribute('aria-expanded','false');
});
test('dropping one text file loads a draft; multiple files preserve it and report the problem',async({app})=>{
 const drop=async(count:number)=>{const transfer=await app.evaluateHandle(count=>{const dt=new DataTransfer();for(let i=0;i<count;i++)dt.items.add(new File(['Laporan dari berkas uji.'],`laporan-${i}.txt`,{type:'text/plain'}));return dt;},count);await app.locator('.chat-composer-box').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();};
 await drop(1);await expect(composer(app)).toHaveValue('Laporan dari berkas uji.');await expect(app.getByRole('status').filter({hasText:'Siap digunakan'})).toBeVisible();await drop(2);await expect(app.getByRole('alert')).toContainText('Pilih satu berkas');await expect(composer(app)).toHaveValue('Laporan dari berkas uji.');
});
