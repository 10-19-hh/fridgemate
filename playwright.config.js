import { defineConfig, devices } from '@playwright/test';

const sharedUse = {
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
  video: 'retain-on-failure'
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.js',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    ...sharedUse,
    ...devices['Desktop Chrome']
  },
  projects: [
    {
      name: 'local-only',
      testMatch: ['local-only.spec.js', 'seed-setup.spec.js', 'accessibility.spec.js', 'ocr-import.spec.js', 'analytics-consent.spec.js', 'public-recipes.spec.js', 'meal-plan.spec.js', 'meal-plan-changes.spec.js', 'purchase-receiving.spec.js'],
      use: {
        ...sharedUse,
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4173'
      }
    },
    {
      name: 'api-mode',
      testMatch: ['api-mode.spec.js', 'sync-conflicts.spec.js', 'meal-plan-account.spec.js', 'meal-cooking.spec.js'],
      use: {
        ...sharedUse,
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4174'
      }
    }
  ]
});
