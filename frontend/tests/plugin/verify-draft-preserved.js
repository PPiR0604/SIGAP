async (page) => {
  // Controlled SSE on the production frontend; no messages or storage decisions are sent.
  const events=[];let id=0;
  const emit=(event,data)=>{const next=++id;events.push({id:next,body:`id: ${next}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`});};
  emit('stored_rekap_ready',{records:[{batch_id:'ui-audit',report_id:'R001',shelter_name:'Posko Uji Draf',village:'Desa Uji',total_people:10,male:4,female:6,elderly:1,disability:0}]});
  await page.route('**/api/sessions/*/events',route=>route.fulfill({contentType:'text/event-stream',body:events.filter(event=>event.id>Number(route.request().headers()['last-event-id']||0)).map(event=>event.body).join('')||': keepalive\n\n'}));
  await page.reload();
  await page.getByRole('button',{name:'Rekap',exact:true}).click();
  await page.getByRole('button',{name:'Posko Uji Draf',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Detail laporan'});
  await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();
  const male=dialog.getByRole('spinbutton',{name:'Laki-laki',exact:true});
  const note=dialog.getByRole('textbox',{name:'Catatan klarifikasi (opsional)'});
  await male.fill('5');await note.fill('Draf tetap ada setelah kalkulasi tiba.');
  emit('calculation_ready',{batch_id:'read-result',shelters:[{shelter_name:'Posko Uji Draf',village:'Desa Uji',needs:{air_liter_per_hari:{value:150}}}]});
  await dialog.getByRole('region',{name:'Hasil perhitungan kebutuhan'}).waitFor();
  if(await male.inputValue()!=='5'||await note.inputValue()!=='Draf tetap ada setelah kalkulasi tiba.')throw new Error('Calculation erased the unsent draft.');
  await page.screenshot({path:'C:/FIle/Dev/Projek Hackation IBM/output/testing/edit-ui-audit/plugin-draft-after.png'});
  return {draft_male:await male.inputValue(),draft_note:await note.inputValue(),calculated:await dialog.getByRole('region',{name:'Hasil perhitungan kebutuhan'}).innerText(),external_write:false};
}
