async (page) => {
  await page.getByRole('dialog').getByRole('button',{name:'Tutup dialog'}).click();
  await page.getByRole('button',{name:'Posko Cibening',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Detail laporan'});
  await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();
  await dialog.getByRole('spinbutton',{name:'Jumlah jiwa',exact:true}).fill('104');
  await dialog.getByRole('spinbutton',{name:'Laki-laki',exact:true}).fill('57');
  await dialog.getByRole('spinbutton',{name:'Perempuan',exact:true}).fill('47');
  await dialog.getByRole('spinbutton',{name:'Lansia',exact:true}).fill('9');
  await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
  return {status:await dialog.getByRole('status').allTextContents(),busy:await dialog.getByRole('button',{name:'Memvalidasi…'}).isDisabled()};
}
