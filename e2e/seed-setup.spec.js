import { expect, test } from '@playwright/test';
import { createIngredient, seedBrowserState } from './support/testApp';

test('seed setup rejects a failed ingredient write instead of marking the fixture ready', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'ingredients' && value.id === 'seed-quota-failure') {
        throw new DOMException('private fixture write details', 'QuotaExceededError');
      }
      return put.call(this, value, ...args);
    };
  });

  const preparation = seedBrowserState(page, {
    ingredients: [createIngredient('seed-quota-failure')]
  });
  await expect(preparation).rejects.toThrow('QuotaExceededError');
  await expect(preparation).rejects.not.toThrow('private fixture write details');

  expect(await page.evaluate(() => ({
    ready: window.__FRIDGEMATE_TEST__.setupComplete,
    marker: window.sessionStorage.getItem('__fridgemate-e2e-seeded__')
  }))).toEqual({ ready: false, marker: null });
  expect(pageErrors).toEqual([]);
});

test('seed setup rejects deletion blocked by another real database connection', async ({ page, context }) => {
  const holder = await context.newPage();
  await holder.route('**/__fridgemate-seed-holder__', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body></body></html>'
  }));
  await holder.goto('/__fridgemate-seed-holder__');
  await holder.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('fridgemate-db__guest');
    request.onsuccess = () => {
      // Keep the connection open across versionchange so deletion really blocks.
      window.heldSeedDatabase = request.result;
      resolve();
    };
    request.onerror = () => reject(request.error);
  }));

  try {
    await expect(seedBrowserState(page)).rejects.toThrow('BlockedError');
    expect(await page.evaluate(() => ({
      ready: window.__FRIDGEMATE_TEST__.setupComplete,
      marker: window.sessionStorage.getItem('__fridgemate-e2e-seeded__')
    }))).toEqual({ ready: false, marker: null });
  } finally {
    await holder.close();
  }
});
