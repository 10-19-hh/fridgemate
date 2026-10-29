import { defineConfig, devices } from '@playwright/test';

// Exercise the isolated pilot artifact, never a development server or dist/.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['pilot-policy.spec.js'],
  outputDir: './test-results/pilot',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: process.env.CI ? [['github']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4283',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --outDir dist-pilot --host 127.0.0.1 --port 4283 --strictPort',
    url: 'http://127.0.0.1:4283',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
