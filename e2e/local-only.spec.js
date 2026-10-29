import { expect, test } from '@playwright/test';
import { createIngredient, gotoAndWait, readBrowserIngredients, seedBrowserState } from './support/testApp';

for (const route of ['/', '/recipes', '/ingredients']) {
  test(`inventory read failure offers recovery without pretending the fridge is empty on ${route}`, async ({ page }, testInfo) => {
    const ingredient = createIngredient('read-failure-egg', { name: '계란', expiryDate: '' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await seedBrowserState(page, { ingredients: [ingredient] });
    await gotoAndWait(page, '/ingredients');
    await expect(page.getByRole('heading', { name: '계란', exact: true })).toBeVisible();
    await page.addInitScript(() => {
      const original = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        if (this.name === 'ingredients' && this.transaction.db.name === 'fridgemate-db__guest') {
          throw new DOMException('Fixture denied ingredient read', 'SecurityError');
        }
        return original.apply(this, args);
      };
      window.restoreInventoryRead = () => { IDBObjectStore.prototype.getAll = original; };
    });
    await gotoAndWait(page, route);
    const alert = page.getByRole('alert').filter({ hasText: /재고를 불러오지 못/ });
    await expect(alert).toContainText(/비어 있는지.*확인/);
    await expect(page.getByText('재료를 등록하면 추천을 시작할 수 있어요', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Fixture denied ingredient read', { exact: false })).toHaveCount(0);
    if (route === '/') {
      await page.setViewportSize({ width: 390, height: 844 });
      await alert.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('inventory-read-failure-mobile.png') });
    }
    await page.evaluate(() => window.restoreInventoryRead());
    await page.getByRole('button', { name: '재고 다시 불러오기', exact: true }).click();
    await expect(alert).toHaveCount(0);
    expect(await readBrowserIngredients(page, 'guest')).toEqual([ingredient]);
    if (route === '/ingredients') {
      await expect(page.getByRole('heading', { name: '계란', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: route === '/' ? '먼저 쓸 재료와 오늘 메뉴를 확인하세요' : '보유 재료로 만들 메뉴를 확인하세요', exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test('inventory delete failure restores the row, explains failure and allows retry', async ({ page }) => {
  const ingredient = createIngredient('delete-failure-milk', { name: '우유', expiryDate: '' });
  await seedBrowserState(page, { ingredients: [ingredient] });
  await gotoAndWait(page, '/ingredients');
  await expect(page.getByRole('heading', { name: '우유', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'ingredients' && key === 'delete-failure-milk') {
        throw new DOMException('Fixture denied delete', 'SecurityError');
      }
      return original.call(this, key);
    };
    window.restoreInventoryDelete = () => { IDBObjectStore.prototype.delete = original; };
  });
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /삭제하지 못/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '우유', exact: true })).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual([ingredient]);
  await page.evaluate(() => window.restoreInventoryDelete());
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '우유', exact: true })).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
});

test('inventory edit read failure locks the form until an explicit successful retry', async ({ page }) => {
  const ingredient = createIngredient('edit-failure-milk', { name: '우유', quantity: '1통', expiryDate: '' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await seedBrowserState(page, { ingredients: [ingredient] });
  await gotoAndWait(page, '/ingredients');
  await expect(page.getByRole('heading', { name: '우유', exact: true })).toBeVisible();
  await page.addInitScript(() => {
    const originals = { get: IDBObjectStore.prototype.get, getAll: IDBObjectStore.prototype.getAll };
    for (const method of ['get', 'getAll']) {
      IDBObjectStore.prototype[method] = function (...args) {
        if (this.name === 'ingredients' && this.transaction.db.name === 'fridgemate-db__guest') {
          throw new DOMException('Fixture denied edit read', 'SecurityError');
        }
        return originals[method].apply(this, args);
      };
    }
    window.restoreEditRead = () => Object.assign(IDBObjectStore.prototype, originals);
  });
  await gotoAndWait(page, '/ingredients/edit-failure-milk/edit');
  await expect(page.getByRole('alert').filter({ hasText: /재료 정보를 불러오지 못/ })).toBeVisible();
  await expect(page.getByLabel('이름')).toBeDisabled();
  await expect(page.getByRole('button', { name: '수정 저장', exact: true })).toBeDisabled();
  await page.evaluate(() => window.restoreEditRead());
  await page.getByRole('button', { name: '재료 다시 불러오기', exact: true }).click();
  await expect(page.getByLabel('이름')).toHaveValue('우유');
  await expect(page.getByLabel('이름')).toBeEnabled();
  await page.getByLabel('수량').fill('2통');
  await page.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([expect.objectContaining({ id: ingredient.id, name: '우유', quantity: '2통' })]);
  expect(errors).toEqual([]);
});

test('local-only mode keeps CRUD data in IndexedDB across reloads', async ({ page }) => {
  await seedBrowserState(page);
  await gotoAndWait(page, '/ingredients/new');

  await page.getByLabel('이름').fill('우유');
  await page.getByLabel('수량').fill('1통');
  await page.getByLabel('카테고리').selectOption('유제품');
  await page.getByLabel('보관 방식').selectOption('냉장');
  await page.getByLabel('구매일').fill('2026-04-14');
  await page.getByRole('button', { name: '재료 추가' }).click();

  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByText('우유')).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('우유')).toBeVisible();

  await page.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByText('우유')).toHaveCount(0);
});

test('blocked local and session storage getters keep public pages and guest IndexedDB CRUD available', async ({ page }) => {
  const pageErrors = [];
  const authRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/auth/')) authRequests.push(request.url());
  });

  // Fresh context: do not use the seed helper, which itself needs Web Storage.
  // This runs before the real main entry and again on every reload; IndexedDB stays real.
  await page.addInitScript(() => {
    for (const storageType of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, storageType, {
        configurable: true,
        get() { throw new DOMException('Fixture storage access denied', 'SecurityError'); }
      });
    }
  });
  await gotoAndWait(page, '/');
  await expect(page.getByRole('heading', { name: '이번 주 저녁부터 정해볼까요?' })).toBeVisible();

  await gotoAndWait(page, '/ingredients/new');
  await page.getByLabel('이름').fill('우유');
  await page.getByLabel('수량').fill('1통');
  await page.getByLabel('카테고리').selectOption('유제품');
  await page.getByLabel('보관 방식').selectOption('냉장');
  await page.getByLabel('구매일').fill('2026-09-28');
  await page.getByRole('button', { name: '재료 추가', exact: true }).click();

  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByText('우유', { exact: true })).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual([
    expect.objectContaining({ name: '우유', quantity: '1통', category: '유제품', storageType: '냉장' })
  ]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('우유', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText('우유', { exact: true })).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '재료를 빠르게 찾고, 지금 쓰실 것부터 정리하세요', exact: true })).toBeVisible();
  await expect(page.getByText('우유', { exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(authRequests).toEqual([]);
});

test('shopping edits survive a local write failure and persist after automatic retry', async ({ page }) => {
  const ingredient = createIngredient('shopping-milk', {
    clientId: 'shopping-milk', name: '우유', category: '유제품', quantity: '1통', memo: '기존 메모', consumed: true
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await seedBrowserState(page, { ingredients: [ingredient] });
  await gotoAndWait(page, '/ingredients');
  const quantity = page.getByRole('textbox', { name: '다음 구매 수량' });
  const memo = page.getByRole('textbox', { name: '장보기 메모', exact: true });
  await expect(quantity).toHaveValue('1통');

  // Abort only this fixture's ingredient write; reads, seed data and other stores stay real.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'ingredients' && this.transaction.db.name === 'fridgemate-db__guest'
        && value.id === 'shopping-milk') {
        throw new DOMException('Fixture storage is full', 'QuotaExceededError');
      }
      return original.call(this, value, ...args);
    };
    window.__FRIDGEMATE_TEST__.restoreShoppingWrite = () => {
      IDBObjectStore.prototype.put = original;
      delete window.__FRIDGEMATE_TEST__.restoreShoppingWrite;
    };
  });

  await quantity.fill('2통');
  await memo.fill('작은 팩으로 구매');
  await expect(page.getByText('저장 실패', { exact: true })).toBeVisible();
  await expect(page.getByText('저장됨', { exact: true })).toHaveCount(0);
  await expect(quantity).toHaveValue('2통');
  await expect(memo).toHaveValue('작은 팩으로 구매');
  expect(await readBrowserIngredients(page, 'guest')).toEqual([ingredient]);

  await page.evaluate(() => window.__FRIDGEMATE_TEST__.restoreShoppingWrite());
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
  await expect(page.getByText('저장 실패', { exact: true })).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([
    { ...ingredient, quantity: '2통', memo: '작은 팩으로 구매' }
  ]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(quantity).toHaveValue('2통');
  await expect(memo).toHaveValue('작은 팩으로 구매');
  expect(pageErrors).toEqual([]);
});

test('guest menu selection survives a reload without a server account', async ({ page }) => {
  await seedBrowserState(page, {
    ingredients: [
      {
        id: 'egg-1',
        name: '계란',
        category: '기타',
        storageType: '냉장',
        quantity: '4개',
        purchaseDate: '2026-08-30',
        expiryDate: '2026-09-02',
        consumed: false
      }
    ]
  });
  await gotoAndWait(page, '/recipes');

  const firstCard = page.locator('article').filter({ has: page.getByRole('button', { name: '오늘 먹기' }) }).first();
  const recipeName = (await firstCard.getByRole('heading').textContent())?.trim();
  await firstCard.getByRole('button', { name: '오늘 먹기' }).click();
  await expect(page.getByRole('button', { name: '선택됨' }).first()).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '선택됨' }).first()).toBeVisible();
  await gotoAndWait(page, '/');
  await expect(page.getByRole('heading', { name: recipeName, exact: true })).toBeVisible();
});

test('pantry write failure preserves ownership and the same action can retry', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrowserState(page, { ingredients: [createIngredient('pantry-fixture', { name: '계란' })] });
  await gotoAndWait(page, '/recipes');
  const salt = page.getByRole('button', { name: /^소금\s*(보유|미보유|모름)$/ });
  await expect(salt).toHaveText(/모름/);
  await salt.click();
  await expect(salt).toHaveText(/소금\s*보유/);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'fridgemate-pantry-ownership:v2:guest') {
        throw new DOMException('Fixture full storage', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
    window.__FRIDGEMATE_TEST__.restorePantryWrite = () => { Storage.prototype.setItem = original; };
  });
  await salt.click();
  await expect(page.getByRole('alert').filter({ hasText: /팬트리/ })).toContainText(/저장하지 못/);
  await expect(salt).toHaveText(/소금\s*보유/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fridgemate-pantry-ownership:v2:guest'))))
    .toEqual({ salt: 'owned' });
  await page.getByRole('alert').filter({ hasText: /팬트리/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pantry-storage-failure-mobile.png') });
  await page.evaluate(() => window.__FRIDGEMATE_TEST__.restorePantryWrite());
  await salt.click();
  await expect(salt).toHaveText(/미보유/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fridgemate-pantry-ownership:v2:guest'))))
    .toEqual({ salt: 'missing' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(salt).toHaveText(/미보유/);
  expect(errors).toEqual([]);
});

test('pantry unreadable storage is not silently replaced and explicit recheck recovers it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await seedBrowserState(page);
  await gotoAndWait(page, '/recipes');
  await page.locator('summary').filter({ hasText: '보유 양념 설정' }).click();
  const salt = page.getByRole('button', { name: /^소금\s*(보유|미보유|모름)$/ });
  await salt.click();
  await expect(salt).toHaveText(/소금\s*보유/);
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'fridgemate-pantry-ownership:v2:guest') {
        throw new DOMException('Fixture denied storage', 'SecurityError');
      }
      return original.call(this, key);
    };
    window.restorePantryRead = () => { Storage.prototype.getItem = original; };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('summary').filter({ hasText: '보유 양념 설정' })).toContainText('확인 필요');
  await page.locator('summary').filter({ hasText: '보유 양념 설정' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /팬트리/ })).toContainText(/불러오지 못/);
  await expect(salt).toBeDisabled();
  await page.evaluate(() => window.restorePantryRead());
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fridgemate-pantry-ownership:v2:guest'))))
    .toEqual({ salt: 'owned' });
  await page.getByRole('button', { name: /팬트리.*다시/ }).click();
  await expect(salt).toBeEnabled();
  await expect(salt).toHaveText(/소금\s*보유/);
  expect(errors).toEqual([]);
});
