async (page) => {
  // Playwright plugin macro. Read/calculation only; never submit a storage decision.
  await page.getByRole('textbox', {name:'Laporan atau pertanyaan Anda'}).fill('Periksa kebutuhan di semua desa berdasarkan rekap tersimpan. Hanya membaca dan menghitung.');
  await page.getByRole('button', {name:'Kirim',exact:true}).click();
  await page.getByRole('button', {name:'Rekap',exact:true}).click();
  await page.locator('tbody tr').nth(7).waitFor({state:'visible',timeout:45000});
  const count=await page.locator('tbody tr').count();
  if(count!==8)throw new Error(`Expected 8 baseline shelters, received ${count}`);
  return {shelters:count,rows:await page.locator('tbody tr').allTextContents()};
}
