import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

// Deliberately simple engine/packaging fixture, not a receipt-accuracy benchmark.
const fixture = fileURLToPath(new URL('./fixtures/ocr-single-ingredient.png', import.meta.url));
const assetPaths = [
  'worker.min.js',
  ...['', '-lstm', '-simd', '-simd-lstm', '-relaxedsimd', '-relaxedsimd-lstm']
    .map(variant => `core/tesseract-core${variant}.wasm.js`),
  'lang/kor.traineddata.gz', 'lang/eng.traineddata.gz'
];

// Read existing guest data only. No seeding, recognition override or API writes.
async function readGuestIngredients(page) {
  return page.evaluate(async () => {
    const name = 'fridgemate-db__guest';
    if (!(await indexedDB.databases()).some(db => db.name === name)) return [];
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('ingredients', 'readonly');
        const request = tx.objectStore('ingredients').getAll();
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  });
}

test('real OCR loads shipped assets, recognizes a Korean ingredient and saves only after review', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const origin = new URL(baseURL).origin;
  const assets = [];
  const probes = [];
  const errors = [];
  const blocked = [];
  // External telemetry and all non-read server requests are excluded. OCR must
  // use genuine same-origin responses; never fulfill a request with a fake result.
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') &&
        (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()))) {
      blocked.push({ origin: url.origin, method: request.method() });
      return route.abort();
    }
    return route.continue();
  });
  context.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/ocr/tesseract/')) {
      assets.push({ path: new URL(response.url()).pathname, status: response.status(), type: response.headers()['content-type'] || '' });
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  try {
    // Some engines do not expose every importScripts response through Playwright.
    // Probe all shipped variants as well as running the real worker below.
    for (const asset of assetPaths) {
      const path = `/ocr/tesseract/${asset}`;
      const url = new URL(path, origin).href;
      const response = await context.request.get(url, { maxRedirects: 0 });
      const type = response.headers()['content-type'] || '';
      probes.push({ path, status: response.status(), type });
      expect(response.status(), path).toBe(200);
      expect(response.url(), path).toBe(url);
      expect(type, path).not.toMatch(/text\/html/);
      const body = await response.body();
      expect(body.length, path).toBeGreaterThan(0);
      expect(body.subarray(0, 200).toString(), path).not.toMatch(/<!doctype html|<html/i);
      if (asset.endsWith('.js')) {
        expect(type, path).toMatch(/javascript/);
      }
      await response.dispose();
    }
    await page.goto('/import');
    expect(await readGuestIngredients(page)).toEqual([]);
    await page.getByLabel('사진 고르기').setInputFiles(fixture);
    await page.getByRole('button', { name: '사진에서 재료 찾기', exact: true }).click();
    const names = page.getByRole('textbox', { name: '이름', exact: true });
    const failure = page.getByText(/사진을 읽는 데 실패했어요|쓸 만한 상품 항목을 찾지 못했어요/);
    await expect.poll(async () => (await names.count()) + (await failure.count()), { timeout: 90000 }).toBeGreaterThan(0);
    await expect(failure).toHaveCount(0);
    const recognizedNames = await names.evaluateAll(inputs => inputs.map(input => input.value));
    expect(recognizedNames).toEqual(['계란']);
    expect(await readGuestIngredients(page)).toEqual([]);
    // A real user correction must survive confirmation and reload.
    await names.first().fill('유정란');
    await page.getByRole('button', { name: '선택 항목 저장', exact: true }).click();
    await expect(page).toHaveURL(/\/ingredients$/);
    expect(await readGuestIngredients(page)).toEqual(expect.arrayContaining([expect.objectContaining({ name: '유정란' })]));
    await page.reload();
    expect(await readGuestIngredients(page)).toEqual(expect.arrayContaining([expect.objectContaining({ name: '유정란' })]));
    expect(assets.map(asset => asset.path)).toEqual(expect.arrayContaining([
      '/ocr/tesseract/lang/kor.traineddata.gz',
      '/ocr/tesseract/lang/eng.traineddata.gz'
    ]));
    for (const asset of assets) {
      expect(asset.status, asset.path).toBe(200);
      expect(asset.type, asset.path).not.toMatch(/text\/html/);
    }
    expect(errors).toEqual([]);
  } finally {
    const evidencePath = testInfo.outputPath('ocr-network-evidence.json');
    await writeFile(evidencePath, JSON.stringify({ probes, assets, blocked, errors }, null, 2));
    await testInfo.attach('ocr-network-evidence', {
      path: evidencePath, contentType: 'application/json'
    });
  }
});
