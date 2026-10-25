import { defineConfig, devices } from '@playwright/test';

// Dedicated ports and an in-memory mock backend keep the operator's data untouched.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5183',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(process.env.SIGAP_BROWSER_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.SIGAP_BROWSER_EXECUTABLE } }
      : {}),
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node --import tsx tests/e2e/start-backend.ts',
      url: 'http://127.0.0.1:8797/api/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --config tests/e2e/vite.config.ts --strictPort',
      url: 'http://127.0.0.1:5183',
      reuseExistingServer: false,
    },
  ],
});
