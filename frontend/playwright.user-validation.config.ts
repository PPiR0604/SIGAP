import {defineConfig,devices} from '@playwright/test';

// Explicit opt-in against the already running local Docker app. No decisions/writes are submitted.
export default defineConfig({
  testDir:'./tests/user-validation',workers:1,retries:0,timeout:180_000,
  expect:{timeout:15_000},outputDir:'test-results-user-validation',
  reporter:[['list'],['json',{outputFile:'test-results-user-validation/results.json'}]],
  use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:5173',screenshot:'only-on-failure',trace:'off'},
});
