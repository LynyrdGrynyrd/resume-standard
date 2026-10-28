import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4178', browserName: 'chromium', channel: 'msedge', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview -- --port 4178 --strictPort', url: 'http://127.0.0.1:4178', reuseExistingServer: false },
});
