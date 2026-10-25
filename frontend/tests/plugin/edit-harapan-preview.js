async (page) => {
  const row=page.locator('tbody tr').filter({has:page.getByRole('button',{name:'Posko Harapan',exact:true})}).filter({hasText:'Sukamaju'});
  await row.getByRole('button',{name:'Posko Harapan',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Detail laporan'});
  await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();
  await dialog.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('102');
  await dialog.getByRole('spinbutton',{name:'Laki-laki',exact:true}).fill('47');
  await dialog.getByRole('spinbutton',{name:'Disabilitas',exact:true}).fill('2');
  await dialog.getByRole('textbox',{name:'Catatan klarifikasi (opsional)'}).fill('Data sintetis untuk pengujian UI. Koreksi hanya Posko Harapan Desa Sukamaju.');
  await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
  return {pending:await dialog.getByRole('status').allTextContents(),submitDisabled:await dialog.getByRole('button',{name:'Memvalidasi…'}).isDisabled(),displayed:await dialog.locator('.detail-grid').first().innerText()};
}
