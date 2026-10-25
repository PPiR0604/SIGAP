async (page) => {
  const dialog=page.getByRole('dialog',{name:'Detail laporan'});
  await dialog.getByRole('button',{name:'Tulis klarifikasi'}).click();
  await dialog.getByRole('textbox',{name:'Catatan klarifikasi (opsional)'}).fill('Koreksi nama posko ini menjadi Posko Cibening Utama. Desa tetap Cibineng. Semua angka dan kebutuhan tetap sama. Data sintetis uji UI.');
  await dialog.getByRole('button',{name:'Validasi perubahan'}).click();
  return {status:await dialog.getByRole('status').allTextContents()};
}
