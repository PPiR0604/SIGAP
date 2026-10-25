import { defineConfig, devices } from '@playwright/test';

// Explicit opt-in: calls the configured Gemini API and local Langflow server.
export default defineConfig({
  testDir: './tests/live',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-live', open: 'never' }], ['json', { outputFile: 'test-results-live/results.json' }]],
  outputDir: 'test-results-live',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5184',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(process.env.SIGAP_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.SIGAP_BROWSER_EXECUTABLE } } : {}),
  },
  webServer: [
    { command: 'node --import tsx tests/live/start-backend.ts', url: 'http://127.0.0.1:8798/api/health', reuseExistingServer: false },
    { command: 'npm run dev -- --config tests/live/vite.config.ts --strictPort', url: 'http://127.0.0.1:5184', reuseExistingServer: false },
  ],
});
