import { expect, test } from '@playwright/test';
import { DEFAULT_USER, createIngredient, gotoAndWait, mockApiSession, seedBrowserState } from './support/testApp';

const WEEK = '2026-09-21';
const NOW = '2026-09-21T08:00:00.000Z';
const FIXTURE_TITLE = '수량 검증용 닭고기 식단';

// Arithmetic fixture, not a catalog recipe or a claim of source review. It
// isolates AT-07/08's 300g stock and two 200g demands from source-water gaps.
function arithmeticPlan() {
  const plan = {
    id: `week:${WEEK}`, schemaVersion: 1, scope: 'guest', weekStart: WEEK,
    revision: 1, createdAt: NOW, updatedAt: NOW,
    preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0, 1] },
    slots: Array.from({ length: 7 }, (_, index) => {
      const date = `2026-09-${21 + index}`;
      return { id: `${date}:dinner`, date, mealType: 'dinner', status: index < 2 ? 'planned' : 'skipped',
        locked: false, servings: 1, templateKey: 'e2e:chicken-arithmetic', templateVersion: 1,
        title: FIXTURE_TITLE, reason: '수량 계산만을 위한 브라우저 테스트 자료', notice: null,
        foodGroups: [{ id: 'proteinFoods', label: '고기·생선·달걀·콩류' }],
        components: [{ id: 'chicken', recipeKey: 'e2e:chicken-arithmetic', recipeVersion: '1', title: '닭고기', role: 'main',
          source: { kind: 'e2e-arithmetic-fixture', id: 'AT-07', name: 'PRD 산술 검증용 자료 — 실제 조리법 아님' },
          sourceServings: 1, servings: 1, servingsStatus: 'verified', nutrition: null, nutritionStatus: 'unverified',
          ingredients: [{ id: 'chicken-line', rawName: '닭고기', normalizedName: '닭고기', foodCode: null,
            ingredientKey: 'food:닭고기', amount: 200, unit: 'g', preparationState: 'raw', selected: true, optional: false,
            quantityStatus: 'verified', quantityReason: 'AT-07 산술 입력', quantityEvidence: 'e2e-arithmetic-only',
            foodGroups: ['proteinFoods'] }] }] };
    }),
  };
  return { id: plan.id, schemaVersion: 2, scope: 'guest', weekStart: WEEK, revision: 1,
    createdAt: NOW, updatedAt: NOW, draft: null, confirmed: plan, archives: [] };
}

async function seedPlanFixture(page) {
  await page.evaluate(value => new Promise((resolve, reject) => {
    const open = indexedDB.open('fridgemate-db__guest');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('mealPlans', 'readwrite');
      transaction.objectStore('mealPlans').put(value);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), arithmeticPlan());
}

async function readState(page, scope = 'guest') {
  return page.evaluate(scopeName => new Promise((resolve, reject) => {
    const open = indexedDB.open(`fridgemate-db__${scopeName.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const names = ['ingredients', 'inventoryQuantities', 'inventoryEvents', 'mealPlans'];
      const transaction = database.transaction(names, 'readonly');
      const reads = names.map(name => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => {
        database.close();
        resolve(Object.fromEntries(names.map((name, index) => [name, reads[index].result])));
      };
      transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), scope);
}

async function start(page, { realCatalog = false } = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  await seedBrowserState(page, { ingredients: [createIngredient('cooking-stock', {
    name: realCatalog ? '밥' : '닭고기', quantity: '300g', purchaseDate: '2026-09-20', expiryDate: '2026-09-30',
    updatedAt: '2026-09-20T08:00:00.000Z', category: realCatalog ? '기타' : '육류', memo: '원본 입고 메모',
  })] });
  const api = await mockApiSession(page, { user: DEFAULT_USER });
  await gotoAndWait(page, '/ingredients');
  const review = page.getByRole('region', { name: '남은 수량 확인', exact: true });
  await review.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  const form = review.getByRole('form', { name: `${realCatalog ? '밥' : '닭고기'} 남은 수량 확인`, exact: true });
  await form.getByLabel('확인한 남은 양', { exact: true }).fill('300');
  await form.getByLabel('단위', { exact: true }).selectOption('g');
  await form.getByLabel('조리 상태', { exact: true }).selectOption(realCatalog ? 'cooked' : 'raw');
  await form.getByRole('button', { name: '확인한 수량 저장', exact: true }).click();
  await expect(form.getByText('사용자 확인됨', { exact: true })).toBeVisible();
  if (!realCatalog) await seedPlanFixture(page);
  await gotoAndWait(page, '/meal-plan');
  await page.getByLabel('주 시작일').fill(WEEK);
  if (realCatalog) {
    for (const day of ['수', '목', '금', '토', '일']) await page.getByRole('checkbox', { name: `${day}요일 저녁`, exact: true }).uncheck();
    await page.getByLabel('피하고 싶은 재료').fill('파스타면, 소면, 쌀, 중화면, 계란, 두부, 닭고기, 김치, 참치캔, 돼지고기, 소고기');
    await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
    await expect(page.getByRole('article', { name: `${WEEK} 저녁 식단` }).getByRole('heading', { name: '시금치 리조또', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  }
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  return api;
}

const meal = page => page.getByRole('article', { name: `${WEEK} 저녁 식단`, exact: true });
const panel = page => page.getByRole('region', { name: '조리와 재고 기록', exact: true });
const history = page => panel(page).getByRole('region', { name: '저장된 조리 이력', exact: true });
const historyMeal = page => history(page).getByRole('article', { name: `${WEEK} 조리 이력`, exact: true });

async function actual150(page) {
  await meal(page).getByRole('button', { name: '만들어 먹었어요', exact: true }).click();
  const form = panel(page).getByRole('form', { name: `조리 사용량 · ${FIXTURE_TITLE}`, exact: true });
  const amount = form.getByRole('spinbutton', { name: '닭고기 (1번 재고) 실제 사용량 (g)', exact: true });
  await expect(amount).toHaveValue('200');
  await amount.fill('150');
  await form.getByRole('checkbox', { name: '실제로 쓴 재고를 모두 확인했어요', exact: true }).check();
  return form;
}

async function expectSingleConsumption(page) {
  await expect(meal(page).getByText('조리 기록됨', { exact: true })).toBeVisible();
  const state = await readState(page);
  expect(state.ingredients.find(item => item.id === 'cooking-stock')).toMatchObject({ quantity: '150g', memo: '원본 입고 메모', consumed: false });
  expect(state.inventoryQuantities.find(item => item.id === 'cooking-stock')).toMatchObject({ status: 'verified', amount: 150, unit: 'g' });
  expect(state.inventoryEvents.filter(event => event.kind === 'cooking')).toHaveLength(1);
  expect(state.inventoryEvents.filter(event => event.kind === 'consumption')).toEqual([
    expect.objectContaining({ lines: [expect.objectContaining({ inventoryId: 'cooking-stock', amount: 150, unit: 'g' })] }),
  ]);
  return state;
}

test('actual 150g is applied once and its inverse preserves a later 500g receipt on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const form = await actual150(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await form.screenshot({ path: testInfo.outputPath('actual-usage-mobile.png') });
  await form.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true }).dblclick();
  const consumed = await expectSingleConsumption(page);
  await expect(panel(page).getByRole('heading', { name: '조리와 재고 기록', exact: true })).toBeFocused();
  await page.reload();
  await page.getByLabel('주 시작일').fill(WEEK);
  expect((await expectSingleConsumption(page)).inventoryEvents).toEqual(consumed.inventoryEvents);
  await expect(meal(page).getByRole('heading', { name: FIXTURE_TITLE, exact: true })).toBeVisible();
  await expect(meal(page).getByRole('button', { name: '메뉴 교체', exact: true })).toHaveCount(0);

  const notes = page.getByRole('region', { name: '장보기 메모', exact: true });
  await notes.getByRole('button', { name: '장보기 메모 열기', exact: true }).click();
  const purchase = notes.getByRole('form', { name: '구매 메모 작성', exact: true });
  await purchase.getByLabel('구매한 품목의 출처', { exact: true }).selectOption({ label: '식단: 닭고기 (50g)' });
  await purchase.getByLabel('실제로 산 양', { exact: true }).fill('500g 한 팩');
  await purchase.getByRole('button', { name: '구매 메모 저장', exact: true }).click();
  const receipts = notes.getByRole('region', { name: '구매 메모 이력', exact: true });
  await receipts.getByText('입고할 양 확인', { exact: true }).click();
  const receive = receipts.getByRole('form', { name: '구매 반영 · 닭고기', exact: true });
  await receive.getByLabel('확인한 구매량', { exact: true }).fill('500');
  await receive.getByLabel('입고 상태', { exact: true }).selectOption('raw');
  await receive.getByLabel('보관 장소', { exact: true }).selectOption('냉장');
  await receive.getByLabel('유통기한(모르면 비워두기)', { exact: true }).fill('2026-09-30');
  await receive.getByRole('button', { name: '확인한 구매량을 재고에 반영', exact: true }).click();
  await expect(receipts.getByText('입고 당시 500g · 현재 남은 양은 냉장고에서 확인해 주세요.', { exact: true })).toBeVisible();
  const received = await readState(page);
  const newStock = received.ingredients.find(item => item.id !== 'cooking-stock');
  expect(newStock).toMatchObject({ name: '닭고기', quantity: '500g 한 팩' });
  await meal(page).getByRole('button', { name: '조리 기록 확인', exact: true }).click();
  await historyMeal(page).getByRole('button', { name: '재고 반영 취소', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: '재고 반영만 취소할까요?', exact: true })).toBeFocused();
  await panel(page).getByRole('button', { name: '재고 반영 취소 확인', exact: true }).click();
  await expect(historyMeal(page)).toContainText('반영 취소');
  await expect(panel(page).getByRole('heading', { name: '조리와 재고 기록', exact: true })).toBeFocused();
  const reversed = await readState(page);
  expect(reversed.ingredients.find(item => item.id === 'cooking-stock')).toMatchObject({ quantity: '300g' });
  expect(reversed.ingredients.find(item => item.id === newStock.id)).toEqual(newStock);
  expect(reversed.inventoryQuantities.find(item => item.id === newStock.id)).toMatchObject({ status: 'verified', amount: 500 });
  expect(reversed.inventoryQuantities.find(item => item.id === 'cooking-stock').status).toBe('unverified');
  expect(reversed.inventoryEvents.filter(event => event.kind === 'consumption-reversal')).toHaveLength(1);
  expect(reversed.mealPlans[0].confirmed.slots[0]).toMatchObject({ status: 'cooked', cooking: { inventoryStatus: 'reversed' } });
  await panel(page).screenshot({ path: testInfo.outputPath('inverse-after-receipt-mobile.png') });
});

test('a real catalog meal can record unknown usage without inventing confirmed remaining stock', async ({ page }) => {
  await start(page, { realCatalog: true });
  const before = await readState(page);
  await meal(page).getByRole('button', { name: '만들어 먹었어요', exact: true }).click();
  await panel(page).getByRole('button', { name: '사용량 없이 조리만 기록', exact: true }).click();
  await expect(meal(page).getByText('조리 기록됨', { exact: true })).toBeVisible();
  const cooked = await readState(page);
  expect(cooked.ingredients).toEqual(before.ingredients);
  expect(cooked.inventoryQuantities.find(item => item.id === 'cooking-stock').status).toBe('unverified');
  expect(cooked.inventoryEvents.filter(event => event.kind === 'consumption')).toEqual([]);
  expect(cooked.mealPlans[0].confirmed.slots[0]).toMatchObject({ status: 'cooked', cooking: { inventoryStatus: 'needs-review' } });
  await page.reload();
  await page.getByLabel('주 시작일').fill(WEEK);
  await expect(meal(page).getByRole('heading', { name: '시금치 리조또', exact: true })).toBeVisible();
  await meal(page).getByRole('button', { name: '조리 기록 확인', exact: true }).click();
  await expect(historyMeal(page)).toContainText('확인 필요');
  await historyMeal(page).getByRole('button', { name: '조리 기록 취소', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: '조리 기록을 취소할까요?', exact: true })).toBeFocused();
  await panel(page).getByRole('button', { name: '조리 기록 취소 확인', exact: true }).click();
  await expect(meal(page).getByRole('button', { name: '만들어 먹었어요', exact: true })).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: '조리와 재고 기록', exact: true })).toBeFocused();
  const cancelled = await readState(page);
  expect(cancelled.ingredients).toEqual(before.ingredients);
  expect(cancelled.inventoryQuantities.find(item => item.id === 'cooking-stock').status).toBe('unverified');
  expect(cancelled.inventoryEvents.filter(event => event.kind === 'cooking-reversal')).toHaveLength(1);
});

test('stale cooking input is rejected after another tab changes stock and an explicit refresh uses the new amount', async ({ page, context }) => {
  await start(page);
  const form = await actual150(page);
  const other = await context.newPage();
  await mockApiSession(other, { user: DEFAULT_USER });
  await gotoAndWait(other, '/ingredients');
  const review = other.getByRole('region', { name: '남은 수량 확인', exact: true });
  await review.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  const quantity = review.getByRole('form', { name: '닭고기 남은 수량 확인', exact: true });
  await quantity.getByLabel('확인한 남은 양', { exact: true }).fill('250');
  await quantity.getByRole('button', { name: '확인한 수량 저장', exact: true }).click();
  await expect(review.getByText('확인한 수량을 저장했어요.', { exact: true })).toBeVisible();
  // Headless Chromium keeps this document focused even while the other page is
  // driven. The old form therefore exercises the repository's version guard,
  // independently of the separate focus-invalidation UI protection.
  await form.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true }).click();
  await expect(form.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true })).toBeEnabled();
  await expect(panel(page).getByRole('alert')).toHaveCount(1);
  await expect(panel(page).getByRole('alert')).toContainText(/바뀌|다시|새로/);
  await expect(meal(page).getByText('조리 기록됨', { exact: true })).toHaveCount(0);
  const state = await readState(page);
  expect(state.inventoryEvents).toEqual([]);
  expect(state.inventoryQuantities.find(item => item.id === 'cooking-stock')).toMatchObject({ status: 'verified', amount: 250 });
  expect(state.mealPlans[0].confirmed.slots[0].status).toBe('planned');
  await panel(page).getByRole('button', { name: '조리 목록 새로고침', exact: true }).click();
  const amount = form.getByRole('spinbutton', { name: '닭고기 (1번 재고) 실제 사용량 (g)', exact: true });
  await expect(amount).toHaveValue('200');
  await amount.fill('150');
  await form.getByRole('checkbox', { name: '실제로 쓴 재고를 모두 확인했어요', exact: true }).check();
  await form.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true }).click();
  await expect(meal(page).getByText('조리 기록됨', { exact: true })).toBeVisible();
  const refreshed = await readState(page);
  expect(refreshed.ingredients.find(item => item.id === 'cooking-stock')).toMatchObject({ quantity: '100g' });
  expect(refreshed.inventoryEvents.filter(event => event.kind === 'consumption')).toHaveLength(1);
  await other.close();
});

test('guest cooking history and input stay private through real login and logout UI', async ({ page }, testInfo) => {
  const api = await start(page);
  await meal(page).getByRole('button', { name: '만들어 먹었어요', exact: true }).click();
  await panel(page).getByRole('button', { name: '사용량 없이 조리만 기록', exact: true }).click();
  await expect(meal(page).getByText('조리 기록됨', { exact: true })).toBeVisible();
  const guest = await readState(page);
  await page.getByRole('link', { name: '로그인', exact: true }).click();
  await page.getByLabel('이메일').fill(DEFAULT_USER.email);
  await page.getByLabel('비밀번호').fill('password123');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('link', { name: '주간 식단', exact: true }).click();
  await expect(page.getByRole('button', { name: '한 주 식단 만들기', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '조리 이력 열기', exact: true }).click();
  await expect(history(page)).toBeVisible();
  await expect(history(page).getByRole('article')).toHaveCount(0);
  expect((await readState(page, 'user:user-1')).inventoryEvents).toEqual([]);
  expect(api.ingredients).toEqual([]);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(meal(page).getByText('조리 기록됨', { exact: true })).toBeVisible();
  await meal(page).getByRole('button', { name: '조리 기록 확인', exact: true }).click();
  await expect(historyMeal(page)).toContainText('확인 필요');
  expect((await readState(page)).inventoryEvents).toEqual(guest.inventoryEvents);
  await panel(page).screenshot({ path: testInfo.outputPath('cooking-history-desktop.png') });
});

test('an aborted cooking transaction never shows success and its UI retry applies only once', async ({ page }) => {
  await start(page);
  const form = await actual150(page);
  const before = await readState(page);
  // Fault injection at IndexedDB only: all form, repository and transaction code
  // remains real, including the earlier stock writes rolled back by this abort.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, ...args) {
      const request = original.call(this, value, ...args);
      if (this.name === 'inventoryEvents' && value?.kind === 'cooking') {
        IDBObjectStore.prototype.add = original;
        this.transaction.abort();
      }
      return request;
    };
  });
  await form.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true }).click();
  await expect(form.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true })).toBeEnabled();
  await expect(panel(page).getByRole('alert')).toHaveCount(1);
  await expect(panel(page).getByRole('alert')).toContainText(/실패|취소|저장/);
  await expect(meal(page).getByText('조리 기록됨', { exact: true })).toHaveCount(0);
  expect(await readState(page)).toEqual(before);
  await form.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true }).click();
  await expectSingleConsumption(page);
});

async function receiveLaterChicken(page) {
  const notes = page.getByRole('region', { name: '장보기 메모', exact: true });
  await notes.getByRole('button', { name: '장보기 메모 열기', exact: true }).click();
  const purchase = notes.getByRole('form', { name: '구매 메모 작성', exact: true });
  await purchase.getByLabel('구매한 품목의 출처', { exact: true }).selectOption({ label: '식단: 닭고기 (50g)' });
  await purchase.getByLabel('실제로 산 양', { exact: true }).fill('500g 한 팩');
  await purchase.getByRole('button', { name: '구매 메모 저장', exact: true }).click();
  const receipts = notes.getByRole('region', { name: '구매 메모 이력', exact: true });
  await receipts.getByText('입고할 양 확인', { exact: true }).click();
  const receive = receipts.getByRole('form', { name: '구매 반영 · 닭고기', exact: true });
  await receive.getByLabel('확인한 구매량', { exact: true }).fill('500');
  await receive.getByLabel('입고 상태', { exact: true }).selectOption('raw');
  await receive.getByLabel('보관 장소', { exact: true }).selectOption('냉장');
  await receive.getByLabel('유통기한(모르면 비워두기)', { exact: true }).fill('2026-09-30');
  await receive.getByRole('button', { name: '확인한 구매량을 재고에 반영', exact: true }).click();
  await expect(receipts.getByText('입고 당시 500g · 현재 남은 양은 냉장고에서 확인해 주세요.', { exact: true })).toBeVisible();
}

async function openCorrection(page) {
  await historyMeal(page).getByRole('button', { name: '실제 사용량 정정', exact: true }).click();
  return panel(page).getByRole('form', { name: `실제 사용량 정정 · ${WEEK} 저녁`, exact: true });
}

test('correcting actual 150g to 100g keeps the later 500g receipt and the cooking fact on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  const actual = await actual150(page);
  await actual.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true }).click();
  const cooked = await expectSingleConsumption(page);
  await page.reload(); await page.getByLabel('주 시작일').fill(WEEK);
  await receiveLaterChicken(page);
  const before = await readState(page);
  const receiptStock = before.ingredients.find(item => item.id !== 'cooking-stock');
  await meal(page).getByRole('button', { name: '조리 기록 확인', exact: true }).click();
  const correction = await openCorrection(page);
  const amount = correction.getByLabel('닭고기 (1번 재고) 정정할 사용량 (g)', { exact: true });
  await expect(amount).toHaveValue('150');
  await amount.fill('100');
  await expect(correction.getByRole('region', { name: '정정 후 재고 미리보기' })).toContainText('150g + 150g − 100g = 200g');
  expect(await readState(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await correction.screenshot({ path: testInfo.outputPath('consumption-correction-mobile.png') });
  await correction.getByRole('checkbox', { name: '정정할 실제 사용량을 모두 확인했어요', exact: true }).check();
  await correction.getByRole('button', { name: '정정한 사용량으로 재고 반영', exact: true }).dblclick();
  await expect(panel(page).getByText('실제 사용량을 정정했어요. 조리 기록은 유지돼요.', { exact: true })).toBeVisible();
  const corrected = await readState(page);
  expect(corrected.ingredients.find(item => item.id === 'cooking-stock').quantity).toBe('200g');
  expect(corrected.ingredients.find(item => item.id === receiptStock.id)).toEqual(receiptStock);
  expect(corrected.inventoryQuantities.filter(item => item.status === 'verified').reduce((sum, item) => sum + item.amount, 0)).toBe(700);
  expect(corrected.inventoryEvents.filter(event => event.kind === 'cooking')).toEqual(cooked.inventoryEvents.filter(event => event.kind === 'cooking'));
  expect(corrected.inventoryEvents.filter(event => event.kind === 'consumption')).toHaveLength(2);
  expect(corrected.mealPlans[0].confirmed.slots[0].status).toBe('cooked');
  await page.reload(); await page.getByLabel('주 시작일').fill(WEEK);
  await meal(page).getByRole('button', { name: '조리 기록 확인', exact: true }).click();
  await expect((await openCorrection(page)).getByLabel('닭고기 (1번 재고) 정정할 사용량 (g)', { exact: true })).toHaveValue('100');
  expect(errors).toEqual([]);
});

test('an aborted correction retains input and retries once; explicit zero usage keeps verified stock', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  const actual = await actual150(page);
  await actual.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true }).click();
  await expectSingleConsumption(page);
  const correction = await openCorrection(page);
  await correction.getByRole('spinbutton').fill('100');
  await correction.getByRole('checkbox', { name: '정정할 실제 사용량을 모두 확인했어요', exact: true }).check();
  const before = await readState(page);
  // Only the IndexedDB commit fails. The real correction form, history checks,
  // repository, earlier stock writes and the eventual rollback remain in use.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, ...args) {
      const request = original.call(this, value, ...args);
      if (this.name === 'inventoryEvents' && value?.kind === 'consumption' && value.replacesId) {
        IDBObjectStore.prototype.add = original;
        this.transaction.abort();
      }
      return request;
    };
  });
  const save = correction.getByRole('button', { name: '정정한 사용량으로 재고 반영', exact: true });
  await save.click(); await expect(save).toBeEnabled();
  await expect(correction.getByRole('alert')).toContainText(/실패|취소|저장/);
  await expect(correction.getByRole('spinbutton')).toHaveValue('100');
  expect(await readState(page)).toEqual(before);
  await save.click();
  await expect(panel(page).getByText('실제 사용량을 정정했어요. 조리 기록은 유지돼요.', { exact: true })).toBeVisible();
  expect((await readState(page)).inventoryEvents.filter(event => event.kind === 'consumption')).toHaveLength(2);
  const zero = await openCorrection(page);
  await zero.getByRole('spinbutton').fill('0');
  await zero.getByRole('checkbox', { name: '정정할 실제 사용량을 모두 확인했어요', exact: true }).check();
  await zero.getByRole('button', { name: '정정한 사용량으로 재고 반영', exact: true }).click();
  await expect(historyMeal(page).getByText('기록한 사용량 0 · 재고 차감 없음', { exact: true })).toBeVisible();
  const zeroed = await readState(page);
  expect(zeroed.ingredients.find(item => item.id === 'cooking-stock').quantity).toBe('300g');
  expect(zeroed.mealPlans[0].confirmed.slots[0].status).toBe('cooked');
  await historyMeal(page).getByRole('button', { name: '재고 반영 취소', exact: true }).click();
  await expect(panel(page).getByText('기록한 사용량이 0이라 재고량과 수량 확인 상태는 바꾸지 않아요. 조리 기록은 남아요.', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: '재고 반영 취소 확인', exact: true }).click();
  await expect(historyMeal(page).getByText('재고 반영 취소됨 · 재고 변경 없음', { exact: true })).toBeVisible();
  const reversed = await readState(page);
  expect(reversed.ingredients).toEqual(zeroed.ingredients);
  expect(reversed.inventoryQuantities).toEqual(zeroed.inventoryQuantities);
  expect(errors).toEqual([]);
});
