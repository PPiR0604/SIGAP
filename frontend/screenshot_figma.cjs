const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  console.log('Navigating to Figma node 34-1922...');
  try {
    await page.goto('https://www.figma.com/design/YddrB8d6HwGYy8tTeoFMPJ/SIGAP?node-id=34-1922&m=dev', {
      waitUntil: 'load',
      timeout: 60000
    });
    console.log('Page loaded, waiting for render...');
    await page.waitForTimeout(15000);
    const screenshotPath = 'C:/Users/LUTHFI/.gemini/antigravity/brain/69d5163f-a2a0-4034-9ca4-a49e4ada1675/figma_34_1922_full.png';
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log('Screenshot saved to', screenshotPath);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
})();
