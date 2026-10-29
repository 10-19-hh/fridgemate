import { expect, test } from '@playwright/test';
import { createIngredient, gotoAndWait, readBrowserIngredients, seedBrowserState } from './support/testApp';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6OZsAAAAASUVORK5CYII=',
  'base64'
);

async function reviewReceipt(page) {
  await page.getByLabel('사진 고르기').setInputFiles({
    name: 'mock-receipt.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG
  });
  await page.getByRole('button', { name: '사진에서 재료 찾기' }).click();
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue('두부');
}

async function readPlanningStores(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('fridgemate-db__guest');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['mealPlans', 'inventoryQuantities', 'inventoryEvents'], 'readonly');
      const plans = tx.objectStore('mealPlans').getAll();
      const quantities = tx.objectStore('inventoryQuantities').getAll();
      const events = tx.objectStore('inventoryEvents').getAll();
      tx.oncomplete = () => { db.close(); resolve({ plans: plans.result, quantities: quantities.result, events: events.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

async function writeOtherTabStock(page, ingredient) {
  await page.evaluate(value => new Promise((resolve, reject) => {
    const open = indexedDB.open('fridgemate-db__guest');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('ingredients', 'readwrite');
      tx.objectStore('ingredients').put(value);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), ingredient);
}

test('OCR correction recovery requires confirmation and preserves reviewed input, stock and the weekly plan', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-28T03:00:00.000Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const old = createIngredient('keep-onion', { name: '양파', memo: '초기화와 무관한 재고' });
  await seedBrowserState(page, { ingredients: [old], ocrResult: { text: '두부 2팩' } });
  await gotoAndWait(page, '/meal-plan');
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('식단을 확정했어요.', { exact: true })).toBeVisible();
  const before = await readPlanningStores(page);
  expect(before.plans.length).toBeGreaterThan(0);
  expect(before.plans[0].confirmed).not.toBeNull();
  const currentRaw = '{"다른재료":{"name":"보존될 안전 행"},"손상":null}';
  const legacyRaw = '{"예전재료":{"name":"옛 보정"}}';
  await page.evaluate(({ currentRaw, legacyRaw }) => {
    localStorage.setItem('fridgemate-import-corrections:v2:guest', currentRaw);
    localStorage.setItem('fridgemate-import-corrections', legacyRaw);
    localStorage.setItem('fridgemate-import-corrections:v2:user:other', '{"다른계정":{"name":"보존"}}');
  }, { currentRaw, legacyRaw });
  await gotoAndWait(page, '/import');
  await reviewReceipt(page);
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('부침 두부');
  await page.getByRole('textbox', { name: '수량', exact: true }).fill('2팩');
  const panel = page.getByRole('region', { name: '이 기기의 보정 기록', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '보정 기록 초기화', exact: true }).click();
  await expect(panel.getByRole('button', { name: '초기화 확인', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '취소', exact: true }).click();
  await expect(panel.getByRole('button', { name: '보정 기록 초기화', exact: true })).toBeFocused();
  expect(await page.evaluate(() => [localStorage.getItem('fridgemate-import-corrections:v2:guest'), localStorage.getItem('fridgemate-import-corrections')])).toEqual([currentRaw, legacyRaw]);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([old]);
  expect(await readPlanningStores(page)).toEqual(before);
  await panel.getByRole('button', { name: '보정 기록 초기화', exact: true }).click();
  const bounds = await panel.evaluate(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.clientWidth, contentWidth: node.scrollWidth }));
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(390);
  expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width + 1);
  await page.screenshot({ path: testInfo.outputPath('correction-confirm-mobile.png'), fullPage: true });
  await panel.getByRole('button', { name: '초기화 확인', exact: true }).click();
  await expect(panel.getByText('이 기기의 보정 기록을 초기화했어요.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('fridgemate-import-corrections:v2:guest'), localStorage.getItem('fridgemate-import-corrections')])).toEqual([null, null]);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections:v2:user:other'))).toBe('{"다른계정":{"name":"보존"}}');
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue('부침 두부');
  await expect(page.getByRole('textbox', { name: '수량', exact: true })).toHaveValue('2팩');
  expect(await readBrowserIngredients(page, 'guest')).toEqual([old]);
  expect(await readPlanningStores(page)).toEqual(before);
  await page.getByRole('button', { name: '선택 항목 저장', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  const saved = await readBrowserIngredients(page, 'guest');
  expect(saved).toHaveLength(2);
  expect(saved.find(row => row.id === old.id)).toEqual(old);
  expect(saved.find(row => row.name === '부침 두부')).toEqual(expect.objectContaining({ quantity: '2팩' }));
  expect((await readPlanningStores(page)).plans).toEqual(before.plans);
  await gotoAndWait(page, '/import');
  await page.getByLabel('사진 고르기').setInputFiles({ name: 'next-receipt.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
  await page.getByRole('button', { name: '사진에서 재료 찾기', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue('부침 두부');
  expect(await readBrowserIngredients(page, 'guest')).toEqual(saved);
  expect(errors).toEqual([]);
});

test('OCR correction recovery discards confirmation when another tab changes the records', async ({ page, context }) => {
  await seedBrowserState(page, { ocrResult: { text: '두부 2팩' } });
  await gotoAndWait(page, '/import');
  await page.evaluate(() => {
    localStorage.setItem('fridgemate-import-corrections:v2:guest', 'null');
    localStorage.setItem('fridgemate-import-corrections', '{"옛기록":{"name":"보존"}}');
  });
  await page.reload();
  await reviewReceipt(page);
  await page.getByRole('textbox', { name: '수량', exact: true }).fill('2팩');
  const panel = page.getByRole('region', { name: '이 기기의 보정 기록', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '보정 기록 초기화', exact: true }).click();
  await expect(panel.getByRole('button', { name: '초기화 확인', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('http://127.0.0.1:4173/import');
  const newRaw = '{"두부":{"name":"다른 탭의 새 보정"}}';
  await other.evaluate(value => localStorage.setItem('fridgemate-import-corrections:v2:guest', value), newRaw);
  await expect(page.getByRole('button', { name: '초기화 확인', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '보정 기록 초기화', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections:v2:guest'))).toBe(newRaw);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections'))).toBe('{"옛기록":{"name":"보존"}}');
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue('두부');
  await expect(page.getByRole('textbox', { name: '수량', exact: true })).toHaveValue('2팩');
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  await other.close();
});

test('OCR correction recovery keeps the current map when legacy deletion fails and retries only after confirmation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const old = createIngredient('unchanged-stock');
  await seedBrowserState(page, { ingredients: [old] });
  await gotoAndWait(page, '/import');
  await page.evaluate(() => {
    localStorage.setItem('fridgemate-import-corrections:v2:guest', 'null');
    localStorage.setItem('fridgemate-import-corrections', '{"두부":{"name":"되살아나면 안 되는 기록"}}');
  });
  await page.reload();
  const before = await readPlanningStores(page);
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    window.__restoreCorrectionRemove = () => { Storage.prototype.removeItem = original; };
    Storage.prototype.removeItem = function (key) {
      if (key === 'fridgemate-import-corrections') throw new DOMException('private deletion fixture', 'SecurityError');
      return original.call(this, key);
    };
  });
  const panel = page.getByRole('region', { name: '이 기기의 보정 기록', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '보정 기록 초기화', exact: true }).click();
  await panel.getByRole('button', { name: '초기화 확인', exact: true }).click();
  await expect(panel).toContainText(/초기화하지 못|완료하지 못/);
  await expect(panel.getByText('이 기기의 보정 기록을 초기화했어요.', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections:v2:guest'))).toBe('null');
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections'))).toBe('{"두부":{"name":"되살아나면 안 되는 기록"}}');
  await expect(page.getByText('private deletion fixture')).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([old]);
  expect(await readPlanningStores(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('correction-delete-failure-mobile.png'), fullPage: true });
  await page.evaluate(() => window.__restoreCorrectionRemove());
  await panel.getByRole('button', { name: '보정 상태 다시 확인', exact: true }).click();
  await panel.getByRole('button', { name: '보정 기록 초기화', exact: true }).click();
  await panel.getByRole('button', { name: '초기화 확인', exact: true }).click();
  await expect(panel.getByText('이 기기의 보정 기록을 초기화했어요.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('fridgemate-import-corrections:v2:guest'), localStorage.getItem('fridgemate-import-corrections')])).toEqual([null, null]);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([old]);
  expect(await readPlanningStores(page)).toEqual(before);
});

test('OCR replacement rolls back both stores on abort and retries without losing the reviewed input', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-28T03:00:00.000Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const old = createIngredient('replace-tofu', { name: '두부', quantity: '300g', memo: '교체 전 기록' });
  const unrelated = createIngredient('keep-onion', { name: '양파', quantity: '2개', memo: '보존할 기록' });
  await seedBrowserState(page, { ingredients: [old, unrelated], ocrResult: { text: '두부 2팩' } });
  await gotoAndWait(page, '/import');
  await reviewReceipt(page);
  await page.getByRole('textbox', { name: '수량', exact: true }).fill('2팩');
  const replacement = page.getByRole('checkbox', { name: /기존 1개 항목/ });
  const deletionNotice = replacement.locator('..').locator('span');
  const visibleNotice = await deletionNotice.evaluate(node => ({
    width: node.clientWidth, contentWidth: node.scrollWidth,
    height: node.clientHeight, contentHeight: node.scrollHeight,
  }));
  expect(visibleNotice.contentWidth).toBeLessThanOrEqual(visibleNotice.width + 1);
  expect(visibleNotice.contentHeight).toBeLessThanOrEqual(visibleNotice.height + 1);
  await replacement.check();
  const before = await readBrowserIngredients(page, 'guest');
  const beforeStores = await readPlanningStores(page);
  // Abort after the last sidecar write succeeds, not before replacement starts.
  // Separate delete/add transactions would leave a partially replaced inventory.
  await page.evaluate(() => {
    window.__ocrLateAbortObserved = false;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const request = original.call(this, value, ...args);
      if (this.name === 'inventoryQuantities' && value?.id === 'replace-tofu') {
        IDBObjectStore.prototype.put = original;
        request.addEventListener('success', () => {
          window.__ocrLateAbortObserved = true;
          this.transaction.abort();
        }, { once: true });
      }
      return request;
    };
  });
  const save = page.getByRole('button', { name: '선택 항목 저장', exact: true });
  await save.click();
  await expect(save).toBeEnabled();
  await expect(page.getByRole('status', { name: '가져오기 결과' })).toContainText(/저장하지 못|취소|실패/);
  expect(await page.evaluate(() => window.__ocrLateAbortObserved)).toBe(true);
  await expect(page.getByRole('textbox', { name: '수량', exact: true })).toHaveValue('2팩');
  await expect(page.getByRole('checkbox', { name: /기존 1개 항목/ })).toBeChecked();
  expect(await readBrowserIngredients(page, 'guest')).toEqual(before);
  expect(await readPlanningStores(page)).toEqual(beforeStores);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections:v2:guest'))).toBeNull();
  await page.screenshot({ path: testInfo.outputPath('ocr-replacement-rollback-mobile.png'), fullPage: true });
  await save.click();
  await expect(page).toHaveURL(/\/ingredients$/);
  const saved = await readBrowserIngredients(page, 'guest');
  expect(saved).toHaveLength(2);
  expect(saved.find(row => row.id === unrelated.id)).toEqual(unrelated);
  expect(saved.some(row => row.id === old.id)).toBe(false);
  expect(saved.find(row => row.name === '두부')).toEqual(expect.objectContaining({ quantity: '2팩' }));
  const quantities = (await readPlanningStores(page)).quantities;
  expect(quantities).toHaveLength(2);
  expect(quantities.every(row => row.status === 'unverified' && row.revision === 1 && !Object.hasOwn(row, 'amount'))).toBe(true);
  await page.reload();
  expect(await readBrowserIngredients(page, 'guest')).toEqual(saved);
  expect(errors).toEqual([]);
});

test('OCR double submission only replaces the reviewed batch and preserves a later same-name batch', async ({ page }) => {
  const old = createIngredient('reviewed-tofu', { name: '두부', memo: '확인한 교체 대상' });
  const later = createIngredient('later-tofu', { name: '두부', quantity: '500g', memo: '아직 확인하지 않은 별도 입고' });
  await seedBrowserState(page, { ingredients: [old], ocrResult: { text: '두부 2팩' } });
  await gotoAndWait(page, '/import');
  await reviewReceipt(page);
  await page.getByRole('textbox', { name: '수량', exact: true }).fill('2팩');
  await page.getByRole('checkbox', { name: /기존 1개 항목/ }).check();
  await writeOtherTabStock(page, later);
  await page.getByRole('button', { name: '선택 항목 저장', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page).toHaveURL(/\/ingredients$/);
  const saved = await readBrowserIngredients(page, 'guest');
  expect(saved).toHaveLength(2);
  expect(saved.find(row => row.id === later.id)).toEqual(later);
  expect(saved.some(row => row.id === old.id)).toBe(false);
  expect(saved.filter(row => row.quantity === '2팩')).toHaveLength(1);
  expect((await readPlanningStores(page)).quantities.every(row => row.revision === 1)).toBe(true);
});

test('OCR replacement rejects changed inventory and lets the user refresh and reconfirm without losing edits', async ({ page }) => {
  const old = createIngredient('changed-tofu', { name: '두부', memo: '검토 당시' });
  await seedBrowserState(page, { ingredients: [old], ocrResult: { text: '두부 2팩' } });
  await gotoAndWait(page, '/import');
  await reviewReceipt(page);
  await page.getByRole('textbox', { name: '수량', exact: true }).fill('2팩');
  await page.getByRole('checkbox', { name: /기존 1개 항목/ }).check();
  const changed = { ...old, memo: '다른 탭에서 수정한 메모' };
  await writeOtherTabStock(page, changed);
  await page.getByRole('button', { name: '선택 항목 저장', exact: true }).click();
  await expect(page.getByRole('status', { name: '가져오기 결과' })).toContainText(/바뀌|변경|다시/);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([changed]);
  expect(await readPlanningStores(page)).toEqual({ plans: [], quantities: [], events: [] });
  await expect(page.getByRole('textbox', { name: '이름', exact: true })).toHaveValue('두부');
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections:v2:guest'))).toBeNull();
  await page.getByRole('button', { name: '재고 다시 확인', exact: true }).click();
  const replace = page.getByRole('checkbox', { name: /기존 1개 항목/ });
  await expect(replace).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: '수량', exact: true })).toHaveValue('2팩');
  expect(await readBrowserIngredients(page, 'guest')).toEqual([changed]);
  await replace.check();
  await page.getByRole('button', { name: '선택 항목 저장', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  const saved = await readBrowserIngredients(page, 'guest');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toEqual(expect.objectContaining({ name: '두부', quantity: '2팩' }));
  expect(saved[0].id).not.toBe(old.id);
});

test('AT-00 two packs stay unmeasured and unsaved until the user reviews and saves them', async ({ page }) => {
  await seedBrowserState(page, { ocrResult: { text: '두부 2팩' } });
  await gotoAndWait(page, '/import');
  await reviewReceipt(page);
  await expect(page.getByText('두부 2팩', { exact: true })).toBeVisible();
  const quantity = page.getByRole('textbox', { name: '수량', exact: true });
  await expect(quantity).not.toHaveValue(/\d+\s*(?:g|kg|ml)/i);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  expect(await readPlanningStores(page)).toEqual({ plans: [], quantities: [], events: [] });
  // The user confirms only package count, never an invented package weight.
  await quantity.fill('2팩');
  await page.getByRole('button', { name: '선택 항목 저장', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  const saved = await readBrowserIngredients(page, 'guest');
  expect(saved).toEqual([expect.objectContaining({ name: '두부', quantity: '2팩' })]);
  expect(await readPlanningStores(page)).toEqual({
    plans: [],
    quantities: [{ id: saved[0].id, revision: 1, schemaVersion: 1, scope: 'guest', status: 'unverified' }],
    events: [],
  });
  await page.reload();
  await expect(page.getByText('두부', { exact: true })).toBeVisible();
  expect((await readBrowserIngredients(page, 'guest'))[0].quantity).toBe('2팩');
});

test('AT-00 a failed image read leaves direct entry and the existing weekly plan available', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-14T08:00:00.000Z'));
  await seedBrowserState(page);
  await gotoAndWait(page, '/');
  await page.getByRole('link', { name: '이번 주 식단 만들기', exact: true }).click();
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await expect(page.getByRole('button', { name: '이 식단 확정', exact: true })).toBeEnabled();
  const before = await readPlanningStores(page);
  await gotoAndWait(page, '/import');
  await page.evaluate(() => {
    window.__FRIDGEMATE_TEST__.extractTextFromImage = async () => { throw new Error('테스트 이미지 읽기 실패'); };
  });
  await page.getByLabel('사진 고르기').setInputFiles({ name: 'failed-receipt.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
  await page.getByRole('button', { name: '사진에서 재료 찾기', exact: true }).click();
  await expect(page.getByText(/사진을 읽는 데 실패했어요/)).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  expect(await readPlanningStores(page)).toEqual(before);
  await page.getByRole('link', { name: '추가', exact: true }).click();
  await page.getByLabel('이름').fill('두부');
  await page.getByLabel('수량').fill('2팩');
  await page.getByRole('button', { name: '재료 추가', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  await page.getByRole('link', { name: /주간 식단/ }).click();
  const board = page.getByRole('region', { name: '한 주 저녁 식단표' });
  await expect(board.getByRole('article')).toHaveCount(7);
  const saved = await readBrowserIngredients(page, 'guest');
  expect(saved).toEqual([expect.objectContaining({ name: '두부', quantity: '2팩' })]);
  expect(await readPlanningStores(page)).toEqual({
    plans: before.plans,
    quantities: [{ id: saved[0].id, revision: 1, schemaVersion: 1, scope: 'guest', status: 'unverified' }],
    events: before.events,
  });
});

test('OCR review flow lets the user edit detected items before saving them', async ({ page }) => {
  await seedBrowserState(page, {
    ocrResult: {
      text: '두부 1모\n우유 1L'
    }
  });
  await gotoAndWait(page, '/import');

  await page.getByLabel('사진 고르기').setInputFiles({
    name: 'mock-receipt.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG
  });
  await page.getByRole('button', { name: '사진에서 재료 찾기' }).click();

  await expect(page.getByText('두부', { exact: true })).toBeVisible();
  await page.getByLabel('이름').first().fill('손두부');
  await page.getByRole('button', { name: '선택 항목 저장' }).click();

  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByText('손두부')).toBeVisible();
});

test('OCR upload rejects spoofed or unsupported image bytes before processing', async ({ page }) => {
  await seedBrowserState(page);
  await gotoAndWait(page, '/import');

  await page.getByLabel('사진 고르기').setInputFiles({
    name: 'spoofed-receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  });

  await expect(page.getByText('손상되었거나 지원하지 않는 이미지예요. PNG, JPG 또는 WEBP 파일을 선택해주세요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '사진에서 재료 찾기' })).toBeDisabled();
});

test('OCR import preserves a damaged learning map while saving reviewed inventory', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await seedBrowserState(page, { ocrResult: { text: '두부 1모' } });
  await gotoAndWait(page, '/import');
  await page.evaluate(() => localStorage.setItem('fridgemate-import-corrections:v2:guest', 'null'));

  // Recognition is stubbed by the existing helper; parsing, review and inventory persistence stay real.
  await reviewReceipt(page);
  await page.getByRole('textbox', { name: '수량', exact: true }).fill('1모');
  await page.getByRole('button', { name: '선택 항목 저장' }).click();

  const notice = page.getByRole('status', { name: '가져오기 결과' }).filter({ hasText: '보정 학습' });
  await expect(notice).toContainText('1개 재료를 냉장고에 저장했어요.');
  await expect(notice).toContainText('보정 학습은 저장하지 못했어요.');
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections:v2:guest'))).toBe('null');
  expect(await readBrowserIngredients(page, 'guest')).toEqual([
    expect.objectContaining({ name: '두부', quantity: '1모' })
  ]);
  await expect(page.getByRole('button', { name: '선택 항목 저장' })).toHaveCount(0);
  await page.getByRole('link', { name: '냉장고 보기', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByText('두부', { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('OCR import retains manual edits in inventory when learning storage exceeds quota', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await seedBrowserState(page, { ocrResult: { text: '두부 1모' } });
  await gotoAndWait(page, '/import');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'fridgemate-import-corrections:v2:guest') {
        throw new DOMException('private fixture quota detail', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  });

  await reviewReceipt(page);
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('손두부');
  await page.getByRole('textbox', { name: '수량', exact: true }).fill('3모');
  await page.getByRole('button', { name: '선택 항목 저장' }).click();

  const notice = page.getByRole('status', { name: '가져오기 결과' }).filter({ hasText: '보정 학습' });
  await expect(notice).toContainText('1개 재료를 냉장고에 저장했어요.');
  await expect(notice).toContainText('보정 학습은 저장하지 못했어요.');
  await expect(page.getByText('private fixture quota detail')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-import-corrections:v2:guest'))).toBeNull();
  expect(await readBrowserIngredients(page, 'guest')).toEqual([
    expect.objectContaining({ name: '손두부', quantity: '3모' })
  ]);
  await expect(page.getByRole('button', { name: '선택 항목 저장' })).toHaveCount(0);
  await page.getByRole('link', { name: '냉장고 보기', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('손두부', { exact: true })).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual([
    expect.objectContaining({ name: '손두부', quantity: '3모' })
  ]);
  expect(pageErrors).toEqual([]);
});
