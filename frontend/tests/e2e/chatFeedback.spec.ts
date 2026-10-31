import {test, expect, composer, sendButton} from './fixtures';

test('pesan langsung muncul, status di bawahnya, dan draf dipulihkan jika gagal', async ({app}) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await app.route('**/api/sessions/*/messages', async route => {
    await pending;
    await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: {message: 'Pengiriman gagal'}})});
  });
  await composer(app).fill('halo');
  await sendButton(app).click();
  const history = app.getByRole('log', {name: 'Riwayat percakapan'});
  const bubble = history.locator('.figma-operator-bubble');
  await expect(bubble).toHaveText('halo');
  await expect(composer(app)).toHaveValue('');
  const status = history.getByRole('status');
  await expect(status).toBeVisible();
  const bubbleBox = await bubble.boundingBox();
  const historyBox = await history.boundingBox();
  const statusBox = await status.boundingBox();
  expect(bubbleBox!.width).toBeLessThan(historyBox!.width / 2);
  expect(statusBox!.y).toBeGreaterThan(bubbleBox!.y);
  release();
  await expect(app.getByRole('alert')).toContainText('Pengiriman gagal');
  await expect(composer(app)).toHaveValue('halo');
  await expect(bubble).toHaveCount(0);
});
