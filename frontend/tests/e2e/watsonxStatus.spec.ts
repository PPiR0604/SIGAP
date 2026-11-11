import {test,expect} from '@playwright/test';

test('pengaturan menampilkan model watsonx tanpa menyatakan koneksi sudah diuji',async({page})=>{
  await page.route('**/api/health',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,json:{...await response.json(),agent:'watsonx',model:'ibm/granite-4-h-small',mode:'live',bob:'not_used'}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Operator',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('ibm/granite-4-h-small');
  await expect(dialog).toContainText('LLM dikonfigurasi');
  await expect(dialog).toContainText('Status koneksi menunjukkan konfigurasi');
});
