import { expect, test } from '@playwright/test';
import { createIngredient, gotoAndWait, seedBrowserState } from './support/testApp';

const WEEK = '2026-09-21';
const NEXT_WEEK = '2026-09-28';
const NOW = `${WEEK}T08:00:00.000Z`;
const day = offset => new Date(Date.parse(`${WEEK}T12:00:00.000Z`) + offset * 86400000).toISOString().slice(0, 10);
const meal = (page, date = WEEK) => page.getByRole('article', { name: `${date} 저녁 식단`, exact: true });
const panel = page => page.getByRole('region', { name: '식단 변경 미리보기', exact: true });

// Hand-checked arithmetic only: this is not a reviewed production recipe.
function arithmeticPlan(weekStart = WEEK, amount = 200) {
  const offset = weekStart === WEEK ? 0 : 7;
  const plan = { id: `week:${weekStart}`, schemaVersion: 1, scope: 'guest', weekStart, revision: 1,
    createdAt: NOW, updatedAt: NOW, preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0] },
    slots: Array.from({ length: 7 }, (_, index) => {
      const date = day(offset + index);
      return { id: `${date}:dinner`, date, mealType: 'dinner', status: index ? 'skipped' : 'planned', locked: false,
        servings: 1, templateKey: `e2e:chicken-${amount}`, templateVersion: 1, title: `산술 검증 닭고기 ${amount}g`, reason: '산술 검증용 자료', notice: null,
        foodGroups: [{ id: 'proteinFoods', label: '고기·생선·달걀·콩류' }],
        components: [{ id: 'chicken', recipeKey: `e2e:chicken-${amount}`, recipeVersion: '1', title: '닭고기', role: 'main',
          source: { kind: 'e2e-arithmetic-fixture', id: 'AT-05', name: '테스트 산술 자료 — 실제 조리법 아님' },
          sourceServings: 1, servings: 1, servingsStatus: 'verified', nutrition: null, nutritionStatus: 'unverified', processInputs: [],
          ingredients: [{ id: 'chicken-line', rawName: '닭고기', normalizedName: '닭고기', foodCode: null,
            ingredientKey: 'food:닭고기', amount, unit: 'g', preparationState: 'raw', selected: true, optional: false,
            quantityStatus: 'verified', quantityReason: 'AT-05 산술 입력', quantityEvidence: 'e2e-arithmetic-only', foodGroups: ['proteinFoods'] }] }] };
    }) };
  return { id: plan.id, schemaVersion: 2, scope: 'guest', weekStart, revision: 1, createdAt: NOW, updatedAt: NOW, draft: null, confirmed: plan, archives: [] };
}

async function seedPlans(page, plans) {
  await page.evaluate(values => new Promise((resolve, reject) => {
    const open = indexedDB.open('fridgemate-db__guest');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('mealPlans', 'readwrite');
      values.forEach(value => transaction.objectStore('mealPlans').put(value));
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), plans);
}

async function readState(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('fridgemate-db__guest');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const names = ['ingredients', 'inventoryQuantities', 'inventoryEvents', 'mealPlans', 'shoppingEntries'];
      const transaction = database.transaction(names, 'readonly');
      const reads = names.map(name => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => { database.close(); resolve(Object.fromEntries(names.map((name, index) => [name, reads[index].result]))); };
      transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
}

async function startArithmetic(page, { twoWeeks = false } = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  await seedBrowserState(page, { ingredients: [createIngredient('move-stock', { name: '닭고기', quantity: '300g',
    category: '육류', purchaseDate: '2026-09-20', expiryDate: twoWeeks ? '2026-10-30' : WEEK,
    updatedAt: '2026-09-20T08:00:00.000Z', memo: '원래 재고 메모 보존' })] });
  await gotoAndWait(page, '/ingredients');
  const review = page.getByRole('region', { name: '남은 수량 확인', exact: true });
  await review.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  const form = review.getByRole('form', { name: '닭고기 남은 수량 확인', exact: true });
  await form.getByLabel('확인한 남은 양', { exact: true }).fill('300');
  await form.getByLabel('단위', { exact: true }).selectOption('g');
  await form.getByLabel('조리 상태', { exact: true }).selectOption('raw');
  await form.getByRole('button', { name: '확인한 수량 저장', exact: true }).click();
  await expect(form.getByText('사용자 확인됨', { exact: true })).toBeVisible();
  await seedPlans(page, twoWeeks ? [arithmeticPlan(), arithmeticPlan(NEXT_WEEK, 100)] : [arithmeticPlan()]);
  await gotoAndWait(page, '/meal-plan');
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
}

async function requestMove(page, targetDate, mode = 'move') {
  await meal(page).getByRole('button', { name: '날짜 이동', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: '식단 변경 미리보기', exact: true })).toBeFocused();
  await panel(page).getByLabel('옮길 날짜', { exact: true }).fill(targetDate);
  await panel(page).getByRole('combobox', { name: '이동 방식', exact: true }).selectOption(mode);
  await panel(page).getByRole('button', { name: '변경안 미리보기', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: '변경안 확정', exact: true })).toBeEnabled();
}

function expectUnchangedNonPlans(after, before) {
  for (const store of ['ingredients', 'inventoryQuantities', 'inventoryEvents', 'shoppingEntries']) expect(after[store]).toEqual(before[store]);
}

async function startOverdue(page) {
  await startArithmetic(page, { twoWeeks: true });
  await seedPlans(page, [arithmeticPlan(NEXT_WEEK, 200)]);
  await page.clock.setFixedTime(new Date(`${NEXT_WEEK}T08:00:00.000Z`));
  await gotoAndWait(page, '/meal-plan');
  await expect(page.getByRole('region', { name: '지난 끼니 확인', exact: true })
    .getByRole('button', { name: `${WEEK} 식단 확인`, exact: true })).toBeVisible();
}

test('AT-18 past confirmed hold survives a skip draft until explicit confirmation without consuming inventory', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await startOverdue(page);
  const before = await readState(page);
  const overdue = page.getByRole('region', { name: '지난 끼니 확인', exact: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await overdue.screenshot({ path: testInfo.outputPath('overdue-notice-mobile.png') });
  const shopping = page.getByRole('region', { name: '식단 장보기 미리보기', exact: true });
  await shopping.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  await expect(shopping.getByRole('list', { name: '등록된 재고 기준 추가 필요량', exact: true })).toContainText('100g');
  const notes = page.getByRole('region', { name: '장보기 메모', exact: true });
  await notes.getByRole('button', { name: '장보기 메모 열기', exact: true }).click();
  await expect(notes.getByRole('region', { name: '보류 중인 지난 끼니', exact: true })).toContainText(WEEK);
  await expect(notes.getByRole('option', { name: /산술 검증 닭고기 200g/ })).toHaveCount(0);
  expect(await readState(page)).toEqual(before);
  await overdue.getByRole('button', { name: `${WEEK} 식단 확인`, exact: true }).click();
  await expect(meal(page).getByText('조리 여부 확인 필요 · 예정 배분 보류', { exact: true })).toBeVisible();
  await expect(meal(page).getByRole('button', { name: '메뉴 교체', exact: true })).toBeDisabled();
  await meal(page).getByRole('button', { name: '만들지 않았어요', exact: true }).click();
  const confirm = page.getByRole('button', { name: '수정 초안으로 확정본 교체', exact: true });
  await expect(confirm).toBeEnabled();
  await expect(overdue.getByRole('button', { name: `${WEEK} 식단 확인`, exact: true })).toBeVisible();
  await shopping.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  await expect(shopping.getByRole('list', { name: '등록된 재고 기준 추가 필요량', exact: true })).toContainText('100g');
  const drafted = await readState(page);
  expect(drafted.mealPlans.find(plan => plan.weekStart === WEEK).confirmed).toEqual(before.mealPlans.find(plan => plan.weekStart === WEEK).confirmed);
  expectUnchangedNonPlans(drafted, before);
  await confirm.click();
  await expect(overdue).toContainText('조리 여부를 확인할 지난 끼니가 없어요.');
  const after = await readState(page);
  expect(after.mealPlans.find(plan => plan.weekStart === WEEK).confirmed.slots[0].status).toBe('skipped');
  expectUnchangedNonPlans(after, before);
  await page.reload();
  await expect(overdue).toContainText('조리 여부를 확인할 지난 끼니가 없어요.');
  expect(await readState(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test('AT-18 moves a missed meal to a future empty day and reloads without consuming or swapping stock', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await startOverdue(page);
  const before = await readState(page);
  const overdue = page.getByRole('region', { name: '지난 끼니 확인', exact: true });
  await overdue.getByRole('button', { name: `${WEEK} 식단 확인`, exact: true }).click();
  await meal(page).getByRole('button', { name: '날짜 이동', exact: true }).click();
  await expect(panel(page).getByRole('option', { name: '두 메뉴 날짜 바꾸기', exact: true })).toHaveCount(0);
  await expect(panel(page).getByLabel('옮길 날짜', { exact: true })).toHaveAttribute('min', NEXT_WEEK);
  await panel(page).getByLabel('옮길 날짜', { exact: true }).fill(day(8));
  await panel(page).getByRole('button', { name: '변경안 미리보기', exact: true }).click();
  await expect(panel(page).getByRole('region', { name: '변경 전 전체 장보기', exact: true })).toContainText('조리 여부 확인 필요');
  expect(await readState(page)).toEqual(before);
  await panel(page).getByRole('button', { name: '변경안 확정', exact: true }).click();
  await expect(panel(page).getByText('변경안을 확정했어요.', { exact: true })).toBeVisible();
  const after = await readState(page);
  expectUnchangedNonPlans(after, before);
  expect(after.mealPlans.find(plan => plan.weekStart === WEEK).confirmed.slots[0].status).toBe('skipped');
  expect(after.mealPlans.find(plan => plan.weekStart === NEXT_WEEK).confirmed.slots[1]).toMatchObject({ status: 'planned', title: '산술 검증 닭고기 200g' });
  await page.reload();
  await expect(meal(page, day(8)).getByRole('heading', { name: '산술 검증 닭고기 200g', exact: true })).toBeVisible();
  await expect(overdue).toContainText('조리 여부를 확인할 지난 끼니가 없어요.');
  expect(await readState(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test('mobile date movement previews expiry without writing and confirms only once across reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startArithmetic(page);
  const before = await readState(page);
  await requestMove(page, day(1));
  const beforeMenu = panel(page).getByRole('article', { name: `${WEEK} 변경 비교`, exact: true }).getByRole('region', { name: '변경 전 메뉴', exact: true });
  await expect(beforeMenu).toContainText('닭고기 200g');
  await expect(panel(page).getByRole('region', { name: '변경 후 전체 장보기', exact: true })).toContainText('기한 확인 필요');
  expect(await readState(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel(page).screenshot({ path: testInfo.outputPath('move-comparison-mobile.png') });
  await panel(page).getByRole('button', { name: '변경 창 닫기', exact: true }).click();
  await expect(meal(page).getByRole('button', { name: '날짜 이동', exact: true })).toBeFocused();
  expect(await readState(page)).toEqual(before);
  await requestMove(page, day(1));
  await panel(page).getByRole('button', { name: '변경안 확정', exact: true }).dblclick();
  await expect(panel(page).getByText('변경안을 확정했어요.', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: '식단 변경 미리보기', exact: true })).toBeFocused();
  const after = await readState(page);
  expectUnchangedNonPlans(after, before);
  expect(after.mealPlans[0]).toMatchObject({ draft: null, revision: 2, archives: [before.mealPlans[0].confirmed] });
  expect(after.mealPlans[0].confirmed.slots[0].status).toBe('skipped');
  expect(after.mealPlans[0].confirmed.slots[1].components).toEqual(before.mealPlans[0].confirmed.slots[0].components);
  await page.reload();
  await expect(meal(page, day(1)).getByRole('heading', { name: '산술 검증 닭고기 200g', exact: true })).toBeVisible();
  expect(await readState(page)).toEqual(after);
  const shopping = page.getByRole('region', { name: '식단 장보기 미리보기', exact: true });
  await shopping.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  await shopping.getByText('확인이 필요한 재료', { exact: true }).click();
  await expect(shopping.getByRole('list', { name: '확인이 필요한 재료', exact: true })).toContainText('기한');
});

test('cross-week swap rolls both weeks back after second write failure and preserves shopping records', async ({ page }, testInfo) => {
  await startArithmetic(page, { twoWeeks: true });
  const notes = page.getByRole('region', { name: '장보기 메모', exact: true });
  await notes.getByRole('button', { name: '장보기 메모 열기', exact: true }).click();
  const manual = notes.getByRole('form', { name: '수동 장보기 추가', exact: true });
  await manual.getByLabel('품목 이름', { exact: true }).fill('우유');
  await manual.getByLabel('필요량 메모', { exact: true }).fill('한 통');
  await manual.getByLabel('내 메모', { exact: true }).fill('식단과 별도로 가족 부탁');
  await manual.getByRole('button', { name: '수동 항목 추가', exact: true }).click();
  await expect(notes.getByText('수동 항목을 저장했어요.', { exact: true })).toBeVisible();
  const purchase = notes.getByRole('form', { name: '구매 메모 작성', exact: true });
  await purchase.getByLabel('구매한 품목의 출처', { exact: true }).selectOption({ label: '직접 입력: 우유 (한 통)' });
  await purchase.getByLabel('실제로 산 양', { exact: true }).fill('1L 한 통');
  await purchase.getByRole('button', { name: '구매 메모 저장', exact: true }).click();
  await expect(notes.getByText('구매 메모를 저장했어요.', { exact: true })).toBeVisible();
  const before = await readState(page);
  expect(before.shoppingEntries.length).toBeGreaterThan(1);
  await requestMove(page, NEXT_WEEK, 'swap');
  await panel(page).screenshot({ path: testInfo.outputPath('swap-comparison-desktop.png') });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args);
      if (this.name === 'mealPlans' && ++writes === 2) {
        IDBObjectStore.prototype.put = original;
        this.transaction.abort();
      }
      return request;
    };
  });
  await panel(page).getByRole('button', { name: '변경안 확정', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(panel(page).getByText('변경안을 확정했어요.', { exact: true })).toHaveCount(0);
  expect(await readState(page)).toEqual(before);
  await panel(page).getByRole('button', { name: '변경안 미리보기', exact: true }).click();
  await panel(page).getByRole('button', { name: '변경안 확정', exact: true }).click();
  await expect(panel(page).getByText('변경안을 확정했어요.', { exact: true })).toBeVisible();
  const after = await readState(page);
  expectUnchangedNonPlans(after, before);
  for (let index = 0; index < 2; index += 1) {
    expect(after.mealPlans[index].archives).toEqual([before.mealPlans[index].confirmed]);
    expect(after.mealPlans[index].confirmed.slots[0].components).toEqual(before.mealPlans[1 - index].confirmed.slots[0].components);
    expect(after.mealPlans[index].draft).toBeNull();
  }
  await page.reload();
  await expect(meal(page).getByRole('heading', { name: '산술 검증 닭고기 100g', exact: true })).toBeVisible();
  expect(await readState(page)).toEqual(after);
});

test('new stock does not rewrite real catalog meals and readjustment preserves locked skipped and cooked slots', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(NOW));
  await seedBrowserState(page);
  await gotoAndWait(page, '/meal-plan');
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await expect(page.getByRole('button', { name: '이 식단 확정', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  await meal(page).getByRole('button', { name: '메뉴 고정', exact: true }).click();
  await expect(meal(page).getByRole('button', { name: '고정 해제', exact: true })).toBeEnabled();
  await meal(page, day(1)).getByRole('button', { name: '외식·건너뛰기', exact: true }).click();
  await expect(meal(page, day(1)).getByRole('heading', { name: '외식하거나 쉬는 날', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '수정 초안으로 확정본 교체', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  await meal(page, day(2)).getByRole('button', { name: '만들어 먹었어요', exact: true }).click();
  const cooking = page.getByRole('region', { name: '조리와 재고 기록', exact: true });
  await cooking.getByRole('button', { name: '사용량 없이 조리만 기록', exact: true }).click();
  await expect(cooking.getByText('조리만 기록했어요. 남은 재고량을 다시 확인해 주세요.', { exact: true })).toBeVisible();
  await cooking.getByRole('button', { name: '조리 창 닫기', exact: true }).click();
  const previous = await readState(page);
  await gotoAndWait(page, '/ingredients/new');
  await page.getByRole('textbox', { name: '이름 *', exact: true }).fill('두부');
  await page.getByRole('textbox', { name: '수량 *', exact: true }).fill('300g');
  await page.getByRole('combobox', { name: '카테고리', exact: true }).selectOption('기타');
  await page.getByRole('combobox', { name: '보관 방식', exact: true }).selectOption('냉장');
  await page.getByLabel('구매일', { exact: true }).fill(WEEK);
  await page.getByRole('button', { name: '재료 추가', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  await gotoAndWait(page, '/meal-plan');
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  const before = await readState(page);
  expect(before.mealPlans).toEqual(previous.mealPlans);
  expect(before.ingredients).toEqual([expect.objectContaining({ name: '두부', quantity: '300g' })]);
  await page.getByRole('button', { name: '이번 주 남은 식단 다시 맞추기', exact: true }).click();
  await panel(page).getByRole('button', { name: '변경안 미리보기', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: '변경안 확정', exact: true })).toBeEnabled();
  expect(await readState(page)).toEqual(before);
  for (const index of [0, 1, 2]) await expect(panel(page).getByRole('article', { name: `${day(index)} 변경 비교`, exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel(page).screenshot({ path: testInfo.outputPath('readjust-catalog-desktop.png') });
  await panel(page).getByRole('button', { name: '변경안 확정', exact: true }).click();
  await expect(panel(page).getByText('변경안을 확정했어요.', { exact: true })).toBeVisible();
  const after = await readState(page);
  expectUnchangedNonPlans(after, before);
  for (const index of [0, 1, 2]) expect(after.mealPlans[0].confirmed.slots[index]).toEqual(before.mealPlans[0].confirmed.slots[index]);
  expect(after.mealPlans[0].confirmed.slots.slice(3).map(slot => slot.templateKey)).not.toEqual(before.mealPlans[0].confirmed.slots.slice(3).map(slot => slot.templateKey));
  const catalog = await page.evaluate(async () => (await import('/src/features/mealPlans/mealPlanCatalog.js')).getMealPlanCatalog());
  for (const slot of after.mealPlans[0].confirmed.slots.slice(3)) {
    expect(slot.components).toEqual(catalog.find(item => item.key === slot.templateKey).components);
  }
  await page.reload();
  await expect(meal(page, day(2)).getByText('조리 기록됨', { exact: true })).toBeVisible();
  expect(await readState(page)).toEqual(after);
});

test('a locked real meal cannot be confirmed against newly excluded source ingredients', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await seedBrowserState(page, { ingredients: [createIngredient('preserved-milk', { name: '우유', quantity: '1L',
    purchaseDate: WEEK, expiryDate: '2026-09-30', memo: '제외조건 변경으로 재고를 건드리지 않음' })] });
  await gotoAndWait(page, '/meal-plan');
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  await meal(page).getByRole('button', { name: '메뉴 고정', exact: true }).click();
  await page.getByRole('button', { name: '수정 초안으로 확정본 교체', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  const before = await readState(page);
  const locked = before.mealPlans[0].confirmed.slots[0];
  const excludedName = locked.components.flatMap(component => component.ingredients).find(line => line.selected).rawName;
  await page.locator('summary').filter({ hasText: '식단 조건' }).click();
  await page.getByLabel('피하고 싶은 재료', { exact: true }).fill(excludedName);
  await page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천', exact: true }).click();
  await expect(page.getByText('수정 초안', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '수정 초안으로 확정본 교체', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('제외 재료');
  await expect(page.getByRole('heading', { name: '확정됨', exact: true })).toHaveCount(0);
  const rejected = await readState(page);
  expect(rejected.mealPlans[0].confirmed).toEqual(before.mealPlans[0].confirmed);
  expect(rejected.mealPlans[0].archives).toEqual(before.mealPlans[0].archives);
  expect(rejected.mealPlans[0].draft.preferences.excludedIngredients).toEqual([excludedName]);
  expectUnchangedNonPlans(rejected, before);
  await page.locator('summary').filter({ hasText: '식단 조건' }).click();
  await page.getByLabel('피하고 싶은 재료', { exact: true }).fill('');
  await page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천', exact: true }).click();
  await page.getByRole('button', { name: '수정 초안으로 확정본 교체', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const resolved = await readState(page);
  expect(resolved.mealPlans[0].draft).toBeNull();
  expect(resolved.mealPlans[0].confirmed.preferences.excludedIngredients).toEqual([]);
  expect(resolved.mealPlans[0].confirmed.slots[0].components).toEqual(locked.components);
  expect(resolved.mealPlans[0].confirmed.slots[0].locked).toBe(true);
  expectUnchangedNonPlans(resolved, before);
});
