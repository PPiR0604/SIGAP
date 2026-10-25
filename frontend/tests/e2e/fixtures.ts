import { test as base, expect, type Page } from '@playwright/test';

export const report = 'Laporan sintetis: Posko Harapan 98 jiwa, laki-laki 45, perempuan 55. Butuh air bersih.';
export const composer = (page: Page) => page.getByRole('textbox', { name: 'Laporan atau pertanyaan Anda' });
export const sendButton = (page: Page) => page.getByRole('button', { name: 'Kirim', exact: true });
export const recapRows = (page: Page) => page.locator('tbody tr');

export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Fonts are unrelated to functionality and must not require internet in the suite.
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    const connected = page.waitForResponse(response => response.url().endsWith('/api/sessions') && response.ok());
    await page.goto('/');
    await connected;
    await expect(page.getByRole('button', { name: 'Backend Mock', exact: true })).toBeVisible();
    await expect(page.getByText('Belum ada kandidat rekap', { exact: true })).toBeVisible();
    await use(page);
    expect(errors, 'Uncaught JavaScript errors').toEqual([]);
  },
});

export async function createPreview(page: Page) {
  await composer(page).fill(report);
  await sendButton(page).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Rekap', exact: true }).click();
  await expect(recapRows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Tinjau & setujui' })).toBeEnabled();
}

export { expect };
