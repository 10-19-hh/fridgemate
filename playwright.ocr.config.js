import { defineConfig, devices } from '@playwright/test';

// Explicit opt-in for a deployed target; otherwise exercise the ordinary dist.
const target = process.env.OCR_SMOKE_BASE_URL;
if (target) {
  const url = new URL(target);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('OCR_SMOKE_BASE_URL must be an HTTP(S) origin without credentials, path or query.');
  }
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'ocr-real.spec.js',
  outputDir: './test-results/ocr',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: target || 'http://127.0.0.1:4273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: target ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4273 --strictPort',
    url: 'http://127.0.0.1:4273',
    reuseExistingServer: false,
    timeout: 15000
  }
});
