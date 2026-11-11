import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/offline',workers:1,timeout:45000,use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:5186'},webServer:{command:'npm run preview -- --host 127.0.0.1 --port 5186 --strictPort',url:'http://127.0.0.1:5186/',reuseExistingServer:false}});
