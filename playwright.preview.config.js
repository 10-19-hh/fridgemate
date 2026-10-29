import { defineConfig, devices } from '@playwright/test';

// Run after a local-only build. Do not import the development-server globalSetup:
// this gate must exercise the emitted HTML and JavaScript in dist/.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['local-only.spec.js', 'seed-setup.spec.js', 'accessibility.spec.js', 'meal-plan.spec.js', 'public-recipes.spec.js'],
  outputDir: './test-results/preview',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: process.env.CI ? [['github']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4273 --strictPort',
    url: 'http://127.0.0.1:4273',
    reuseExistingServer: false,
    timeout: 15000
  }
});
