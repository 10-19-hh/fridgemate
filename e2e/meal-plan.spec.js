import { expect, test } from '@playwright/test';
import { createIngredient, gotoAndWait, readBrowserIngredients, seedBrowserState } from './support/testApp';

const weekStart = '2026-09-14';

async function openPlanner(page, ingredients = []) {
  await seedBrowserState(page, { ingredients });
  await gotoAndWait(page, '/meal-plan');
  await expect(page.getByRole('heading', { name: '이번 주 저녁, 미리 골라두세요' })).toBeVisible();
  await page.getByLabel('주 시작일').fill(weekStart);
  await expect(page.getByRole('button', { name: '한 주 식단 만들기' })).toBeEnabled();
}

async function waitForSave(page) {
  await expect(page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' })).toBeEnabled();
}

async function readStoredWeek(page) {
  return page.evaluate((week) => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('fridgemate-db__guest');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('mealPlans', 'readonly');
      const read = transaction.objectStore('mealPlans').get(`week:${week}`);
      transaction.oncomplete = () => { database.close(); resolve(read.result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), weekStart);
}

for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`ACQ-01 public introduction starts a guest plan without registration on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-14T08:00:00.000Z'));
    await page.setViewportSize(viewport);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await seedBrowserState(page);
    await gotoAndWait(page, '/about');
    const main = page.getByRole('main');
    const start = main.getByRole('link', { name: '이번 주 식단 만들기', exact: true });
    await expect(start).toHaveAttribute('href', '/meal-plan');
    await expect(main).toContainText('오늘뭐먹지');
    await expect(main).toContainText('FridgeMate');
    await expect(main.getByRole('link', { name: '메뉴부터 둘러보기', exact: true })).toHaveAttribute('href', '/recipes');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
    expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`public-introduction-${viewport.name}.png`), fullPage: true });

    await start.focus(); await expect(start).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/meal-plan$/);
    await page.getByLabel('주 시작일').fill(weekStart);
    await page.getByLabel('식사 인원').selectOption('2');
    for (const day of ['화', '수', '목', '금', '토', '일']) await page.getByLabel(`${day}요일 저녁`, { exact: true }).uncheck();
    await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
    await waitForSave(page);
    expect((await readStoredWeek(page)).confirmed).toBeNull();
    await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
    await expect(page.getByText('식단을 확정했어요.', { exact: true })).toBeVisible();
    expect((await readStoredWeek(page)).confirmed.preferences).toEqual({ servings: 2, excludedIngredients: [], dinnerDays: [0] });
    expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('fridgemate-auth-session'))).toBeNull();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^noindex(?:,|$)/);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('FR-00 a guest starts from home and makes a chosen-days plan without registering inventory', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-14T08:00:00.000Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await seedBrowserState(page);
  await gotoAndWait(page, '/');
  const start = page.getByRole('link', { name: '이번 주 식단 만들기', exact: true });
  await expect(start).toBeVisible();
  await expect(page.getByRole('link', { name: '재료 추가', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '남은 재료로 무엇을 만들까요?' })).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const header = page.locator('main section').filter({ has: page.getByRole('heading', { level: 1 }) }).first();
  await header.screenshot({ path: testInfo.outputPath('first-plan-home-mobile.png') });
  await start.focus(); await expect(start).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/meal-plan$/);
  await page.getByLabel('식사 인원').selectOption('2');
  await page.getByLabel('피하고 싶은 재료').fill('새우');
  for (const day of ['화', '수', '금', '토', '일']) await page.getByLabel(`${day}요일 저녁`, { exact: true }).uncheck();
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await waitForSave(page);
  const draft = await readStoredWeek(page);
  expect(draft.confirmed).toBeNull();
  expect(draft.draft.preferences).toEqual({ servings: 2, excludedIngredients: ['새우'], dinnerDays: [0, 3] });
  expect(draft.draft.slots.map(slot => slot.status)).toEqual(['planned', 'skipped', 'skipped', 'planned', 'skipped', 'skipped', 'skipped']);
  const monday = page.getByRole('article', { name: '2026-09-14 저녁 식단' });
  await expect(monday.locator('summary')).toContainText('구매 또는 보유 확인 필요');
  await monday.locator('summary').click();
  await expect(monday).not.toContainText('미보유');
  await monday.screenshot({ path: testInfo.outputPath('unregistered-plan-mobile.png') });
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('식단을 확정했어요.', { exact: true })).toBeVisible();
  expect((await readStoredWeek(page)).confirmed.preferences.servings).toBe(2);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-auth-session'))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(monday.getByRole('heading', { level: 3 })).toHaveText(draft.draft.slots[0].title);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^noindex(?:,|$)/);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  expect(errors).toEqual([]);
});

test('weekly dinners can be replaced, locked and reloaded without changing inventory', async ({ page }, testInfo) => {
  const ingredients = [
    createIngredient('rice', { name: '밥', quantity: '2공기', expiryDate: '2026-09-21' }),
    createIngredient('egg', { name: '계란', quantity: '6개', expiryDate: '2026-09-21' })
  ];
  await openPlanner(page, ingredients);
  const originalInventory = await readBrowserIngredients(page, 'guest');
  await page.getByLabel('식사 인원').selectOption('2');
  await page.getByLabel('피하고 싶은 재료').fill('버섯, 가지');
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await expect(page.getByRole('article')).toHaveCount(7);
  await waitForSave(page);

  const monday = page.getByRole('article', { name: '2026-09-14 저녁 식단' });
  const before = await monday.getByRole('heading', { level: 3 }).textContent();
  await monday.getByRole('button', { name: '메뉴 교체' }).click();
  await expect(monday.getByRole('heading', { level: 3 })).not.toHaveText(before);
  await waitForSave(page);
  const replaced = await monday.getByRole('heading', { level: 3 }).textContent();
  await monday.getByRole('button', { name: '메뉴 고정' }).click();
  await expect(monday.getByRole('button', { name: '고정 해제' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' }).click();
  await waitForSave(page);
  await expect(monday.getByRole('heading', { level: 3 })).toHaveText(replaced);

  const sunday = page.getByRole('article', { name: '2026-09-20 저녁 식단' });
  await sunday.getByRole('button', { name: '외식·건너뛰기' }).click();
  await expect(sunday.getByRole('heading', { level: 3 })).toHaveText('외식하거나 쉬는 날');
  await waitForSave(page);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(originalInventory);

  await page.reload();
  await page.getByLabel('주 시작일').fill(weekStart);
  await expect(monday.getByRole('heading', { level: 3 })).toHaveText(replaced);
  await expect(sunday.getByRole('heading', { level: 3 })).toHaveText('외식하거나 쉬는 날');
  await expect(page.getByLabel('식사 인원')).toHaveValue('2');
  await expect(page.getByLabel('피하고 싶은 재료')).toHaveValue('버섯, 가지');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^noindex(?:,|$)/);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(originalInventory);

  await page.getByRole('button', { name: '다음 주' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '한 주 식단 만들기' })).toBeVisible();
  await page.getByRole('button', { name: '이전 주' }).click();
  await expect(monday.getByRole('heading', { level: 3 })).toHaveText(replaced);
  await page.screenshot({ path: testInfo.outputPath('meal-plan-desktop.png') });
});

test('mobile dinner days, ingredient disclosure and empty candidates stay usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlanner(page);
  await page.getByLabel('일요일 저녁').uncheck();
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await expect(page.getByRole('article')).toHaveCount(7);
  await waitForSave(page);
  await expect(page.getByRole('article', { name: '2026-09-20 저녁 식단' }).getByRole('heading')).toHaveText('외식하거나 쉬는 날');
  const monday = page.getByRole('article', { name: '2026-09-14 저녁 식단' });
  await monday.locator('summary').click();
  await expect(monday.getByText(/재료별 필요량과 실제 분량은 확인되지 않았어요/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const buttonBox = await monday.getByRole('button', { name: '메뉴 교체' }).boundingBox();
  expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  await monday.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('meal-plan-mobile.png') });

  await page.locator('summary').filter({ hasText: '식단 조건' }).click();
  await page.getByLabel('피하고 싶은 재료').fill('밥, 파스타면, 소면, 식빵, 우동면, 밀가루, 계란, 두부, 닭고기, 감자, 김치, 참치캔');
  await page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' }).click();
  await waitForSave(page);
  await expect(page.getByRole('heading', { name: '조건에 맞는 메뉴가 없어요' })).toHaveCount(6);
  await expect(page.getByRole('heading', { name: '외식하거나 쉬는 날' })).toHaveCount(1);
});

test('confirmation and a revised draft survive reload without changing stock', async ({ page }, testInfo) => {
  // This checks editing a current confirmation, not the overdue-meal guard.
  await page.clock.setFixedTime(new Date('2026-09-14T08:00:00.000Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlanner(page, [createIngredient('chicken', { name: '닭고기', quantity: '300g', expiryDate: '2026-09-21' })]);
  const stock = await readBrowserIngredients(page, 'guest');
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await waitForSave(page);
  const firstDraft = await readStoredWeek(page);
  expect(firstDraft.schemaVersion).toBe(2);
  expect(firstDraft.confirmed).toBeNull();
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  const firstConfirmed = await readStoredWeek(page);
  await expect(page.getByRole('heading', { name: '확정됨', exact: true })).toBeFocused();
  expect(firstConfirmed.draft).toBeNull();
  expect(firstConfirmed.confirmed).toEqual(firstDraft.draft);

  const monday = page.getByRole('article', { name: '2026-09-14 저녁 식단' });
  const firstTitle = await monday.getByRole('heading', { level: 3 }).textContent();
  await monday.getByRole('button', { name: '메뉴 교체' }).click();
  await expect(monday.getByRole('heading', { level: 3 })).not.toHaveText(firstTitle);
  await waitForSave(page);
  const revised = await readStoredWeek(page);
  expect(revised.confirmed).toEqual(firstConfirmed.confirmed);
  expect(revised.draft.slots[0].title).not.toBe(firstTitle);
  await expect(page.getByRole('region', { name: '현재 확정된 식단' })).toContainText(firstTitle);

  await page.reload();
  await page.getByLabel('주 시작일').fill(weekStart);
  await expect(page.getByText('수정 초안', { exact: true })).toBeVisible();
  await expect(monday.getByRole('heading', { level: 3 })).toHaveText(revised.draft.slots[0].title);
  await expect(page.getByRole('region', { name: '현재 확정된 식단' })).toContainText(firstTitle);
  expect(await readStoredWeek(page)).toEqual(revised);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('meal-plan-revised-mobile.png'), fullPage: true });

  await page.getByRole('button', { name: '수정 초안으로 확정본 교체', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  const reconfirmed = await readStoredWeek(page);
  expect(reconfirmed.confirmed).toEqual(revised.draft);
  expect(reconfirmed.archives).toEqual([firstConfirmed.confirmed]);
  expect(reconfirmed.draft).toBeNull();
  expect(await readBrowserIngredients(page, 'guest')).toEqual(stock);
  await page.reload();
  await page.getByLabel('주 시작일').fill(weekStart);
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  expect(await readStoredWeek(page)).toEqual(reconfirmed);
});

test('a second tab cannot confirm an unseen edited draft and can explicitly reload it', async ({ page, context }) => {
  await openPlanner(page);
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await waitForSave(page);
  const other = await context.newPage();
  await gotoAndWait(other, '/meal-plan');
  await other.getByLabel('주 시작일').fill(weekStart);
  await expect(other.getByRole('button', { name: '이 식단 확정', exact: true })).toBeEnabled();
  await page.getByRole('article', { name: '2026-09-14 저녁 식단' }).getByRole('button', { name: '외식·건너뛰기' }).click();
  await waitForSave(page);
  const edited = await readStoredWeek(page);
  await other.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('다른');
  expect(await readStoredWeek(other)).toEqual(edited);
  expect(edited.confirmed).toBeNull();
  await other.getByRole('button', { name: '저장된 식단 다시 불러오기' }).click();
  await expect(other.getByRole('article', { name: '2026-09-14 저녁 식단' }).getByRole('heading', { level: 3 }))
    .toHaveText('외식하거나 쉬는 날');
  await other.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(other.getByText('확정됨', { exact: true })).toBeVisible();
  expect((await readStoredWeek(other)).confirmed).toEqual(edited.draft);
});

test('a legacy saved plan stays unconfirmed and unchanged until explicit confirmation', async ({ page }) => {
  await openPlanner(page);
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await waitForSave(page);
  const legacy = (await readStoredWeek(page)).draft;
  await page.evaluate((snapshot) => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('fridgemate-db__guest');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('mealPlans', 'readwrite');
      transaction.objectStore('mealPlans').put(snapshot);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), legacy);
  await page.reload();
  await page.getByLabel('주 시작일').fill(weekStart);
  await expect(page.getByText('초안', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '이 식단 확정', exact: true })).toBeEnabled();
  expect(await readStoredWeek(page)).toEqual(legacy);
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  expect((await readStoredWeek(page)).confirmed).toEqual(legacy);
});

test('shopping preview uses the confirmed plan while an edited draft leaves inventory untouched', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-09-15T03:00:00.000Z'));
  await openPlanner(page, [
    createIngredient('preview-chicken', {
      name: '닭고기', quantity: '300g', expiryDate: '2026-09-21', memo: '내일 저녁용'
    }),
    createIngredient('preview-consumed-egg', {
      name: '계란', quantity: '2개', expiryDate: '2026-09-21', consumed: true, memo: '이미 사용한 재료'
    })
  ]);
  const inventoryBefore = await readBrowserIngredients(page, 'guest');
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await waitForSave(page);

  const preview = page.getByRole('region', { name: '식단 장보기 미리보기' });
  await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  await expect(preview.getByText('오늘 이후 확정된 식단이 없어요.')).toBeVisible();
  await expect(preview.getByRole('listitem')).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventoryBefore);

  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  const reviewItems = preview.getByRole('list', { name: '확인이 필요한 재료', exact: true }).getByRole('listitem');
  await preview.locator('summary').filter({ hasText: '확인이 필요한 재료' }).click();
  await expect(reviewItems.first()).toBeVisible();
  await expect(preview.getByRole('list', { name: '등록된 재고 기준 추가 필요량', exact: true }).getByRole('listitem')).toHaveCount(0);
  const confirmedReview = await reviewItems.allTextContents();
  const confirmedPlan = (await readStoredWeek(page)).confirmed;
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventoryBefore);

  const tuesday = page.getByRole('article', { name: '2026-09-15 저녁 식단' });
  const originalTitle = await tuesday.getByRole('heading', { level: 3 }).textContent();
  await tuesday.getByRole('button', { name: '메뉴 교체' }).click();
  await expect(tuesday.getByRole('heading', { level: 3 })).not.toHaveText(originalTitle);
  await waitForSave(page);
  await expect(reviewItems).toHaveCount(0);
  await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  await preview.locator('summary').filter({ hasText: '확인이 필요한 재료' }).click();
  await expect(reviewItems.first()).toBeVisible();
  expect(await reviewItems.allTextContents()).toEqual(confirmedReview);
  expect((await readStoredWeek(page)).confirmed).toEqual(confirmedPlan);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventoryBefore);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('preview-allocation-mobile.png'), fullPage: true });
  await preview.getByRole('heading', { name: '식단 장보기 미리보기', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('preview-allocation-viewport-mobile.png') });
});

test('shopping preview requires a fresh check after refocus and reload', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-15T03:00:00.000Z'));
  await openPlanner(page);
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await waitForSave(page);
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();

  const preview = page.getByRole('region', { name: '식단 장보기 미리보기' });
  const reviewItems = preview.getByRole('list', { name: '확인이 필요한 재료', exact: true }).getByRole('listitem');
  await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  await preview.locator('summary').filter({ hasText: '확인이 필요한 재료' }).click();
  await expect(reviewItems.first()).toBeVisible();
  const firstReview = await reviewItems.allTextContents();

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(preview.getByText('다른 화면의 변경을 반영하려면 다시 계산해 주세요.')).toBeVisible();
  await expect(reviewItems).toHaveCount(0);
  await preview.getByRole('button', { name: '다시 계산', exact: true }).click();
  await preview.locator('summary').filter({ hasText: '확인이 필요한 재료' }).click();
  await expect(reviewItems.first()).toBeVisible();
  expect(await reviewItems.allTextContents()).toEqual(firstReview);

  await page.reload();
  await page.getByLabel('주 시작일').fill(weekStart);
  await expect(preview.getByRole('button', { name: '식단 장보기 확인', exact: true })).toBeEnabled();
  await expect(reviewItems).toHaveCount(0);
  await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  await preview.locator('summary').filter({ hasText: '확인이 필요한 재료' }).click();
  await expect(reviewItems.first()).toBeVisible();
  expect(await reviewItems.allTextContents()).toEqual(firstReview);
});

test('inventory quantity review persists separately from raw stock and can be canceled', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrowserState(page, {
    ingredients: [
      createIngredient('stock-review-chicken', {
        name: '닭고기', quantity: '반 모', expiryDate: '2026-09-21', memo: '등록할 때 적은 원문 메모'
      }),
      createIngredient('stock-review-consumed', {
        name: '계란', quantity: '2개', expiryDate: '2026-09-21', consumed: true, memo: '이미 사용했어요'
      })
    ]
  });
  await gotoAndWait(page, '/ingredients');
  const rawStock = await readBrowserIngredients(page, 'guest');
  const panel = page.getByRole('region', { name: '남은 수량 확인', exact: true });
  await panel.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  const review = panel.getByRole('form', { name: '닭고기 남은 수량 확인', exact: true });
  await expect(panel.getByRole('form', { name: '계란 남은 수량 확인', exact: true })).toHaveCount(0);
  await expect(review.getByLabel('계산에 사용할 재료 이름', { exact: true })).toHaveValue('닭고기');
  await expect(review.getByLabel('확인한 남은 양', { exact: true })).toHaveValue('');
  await expect(review.getByLabel('단위', { exact: true })).toHaveValue('');
  await expect(review.getByLabel('조리 상태', { exact: true })).toHaveValue('');
  await expect(review.getByRole('button', { name: '확인한 수량 저장', exact: true })).toBeDisabled();
  await review.getByLabel('계산에 사용할 재료 이름', { exact: true }).fill('닭고기');
  await review.getByLabel('확인한 남은 양', { exact: true }).fill('300');
  await review.getByLabel('단위', { exact: true }).selectOption('g');
  await review.getByLabel('조리 상태', { exact: true }).selectOption('raw');
  await review.getByRole('button', { name: '확인한 수량 저장', exact: true }).click();
  await expect(review.getByText('사용자 확인됨', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('quantity-mobile.png'), fullPage: true });
  expect(await readBrowserIngredients(page, 'guest')).toEqual(rawStock);

  await page.reload();
  await panel.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  await expect(review.getByText('사용자 확인됨', { exact: true })).toBeVisible();
  await expect(review.getByLabel('확인한 남은 양', { exact: true })).toHaveValue('300');
  await expect(review.getByLabel('단위', { exact: true })).toHaveValue('g');
  await expect(review.getByLabel('조리 상태', { exact: true })).toHaveValue('raw');
  expect(await readBrowserIngredients(page, 'guest')).toEqual(rawStock);

  await review.getByRole('button', { name: '수량 확인 취소', exact: true }).click();
  await expect(review.getByText('수량 확인 필요', { exact: true })).toBeVisible();
  await expect(review.getByLabel('확인한 남은 양', { exact: true })).toHaveValue('');
  await expect(review.getByLabel('단위', { exact: true })).toHaveValue('');
  await expect(review.getByLabel('조리 상태', { exact: true })).toHaveValue('');
  await page.reload();
  await panel.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  await expect(review.getByText('수량 확인 필요', { exact: true })).toBeVisible();
  await expect(review.getByLabel('확인한 남은 양', { exact: true })).toHaveValue('');
  expect(await readBrowserIngredients(page, 'guest')).toEqual(rawStock);
});

test('inventory quantity review requires confirmation again after the raw quantity changes', async ({ page }) => {
  await seedBrowserState(page, {
    ingredients: [createIngredient('stock-review-stale', {
      name: '닭고기', quantity: '반 모', expiryDate: '2026-09-21', memo: '원래 메모는 유지'
    })]
  });
  await gotoAndWait(page, '/ingredients');
  const panel = page.getByRole('region', { name: '남은 수량 확인', exact: true });
  await panel.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  const review = panel.getByRole('form', { name: '닭고기 남은 수량 확인', exact: true });
  await review.getByLabel('확인한 남은 양', { exact: true }).fill('300');
  await review.getByLabel('단위', { exact: true }).selectOption('g');
  await review.getByLabel('조리 상태', { exact: true }).selectOption('raw');
  await review.getByRole('button', { name: '확인한 수량 저장', exact: true }).click();
  await expect(review.getByText('사용자 확인됨', { exact: true })).toBeVisible();

  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: '닭고기', exact: true }) })
    .getByRole('link', { name: '수정', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '수량 *', exact: true })).toHaveValue('반 모');
  await page.getByRole('textbox', { name: '수량 *', exact: true }).fill('200g');
  await page.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page).toHaveURL(/\/ingredients$/);
  await panel.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  // Invalidated records retain only a revision marker, not the cause or prior food details.
  await expect(review.getByText('수량 확인 필요', { exact: true })).toBeVisible();
  await expect(review.getByText('사용자 확인됨', { exact: true })).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([
    expect.objectContaining({
      id: 'stock-review-stale', name: '닭고기', quantity: '200g', memo: '원래 메모는 유지', consumed: false
    })
  ]);
});

test('source-reviewed dinner scales and allocates user-confirmed stock through save and mobile reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-09-16T03:00:00.000Z'));
  const quantities = [
    ['밥', 300, 'cooked'], ['시금치', 100, 'raw'], ['마', 20, 'raw'],
    ['두유', 300, 'as-sold'], ['소금', 2, 'as-sold'], ['버터', 16, 'as-sold'], ['후춧가루', 2, 'as-sold'],
  ];
  const ingredients = quantities.map(([name], index) => createIngredient(`dinner-stock-${index}`, {
    name, quantity: '원본 수량 메모', expiryDate: '2026-09-21', memo: '사용자 메모 유지',
  }));
  await seedBrowserState(page, { ingredients });
  await gotoAndWait(page, '/ingredients');
  const panel = page.getByRole('region', { name: '남은 수량 확인', exact: true });
  await panel.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  for (const [name, amount, preparation] of quantities) {
    const form = panel.getByRole('form', { name: `${name} 남은 수량 확인`, exact: true });
    await form.getByLabel('확인한 남은 양', { exact: true }).fill(String(amount));
    await form.getByLabel('단위', { exact: true }).selectOption('g');
    await form.getByLabel('조리 상태', { exact: true }).selectOption(preparation);
    await form.getByRole('button', { name: '확인한 수량 저장', exact: true }).click();
    await expect(form.getByText('사용자 확인됨', { exact: true })).toBeVisible();
  }
  const inventory = await readBrowserIngredients(page, 'guest');
  await gotoAndWait(page, '/meal-plan');
  await page.getByLabel('주 시작일').fill('2026-09-21');
  await page.getByLabel('식사 인원').selectOption('2');
  for (const name of ['화요일', '수요일', '목요일', '금요일', '토요일', '일요일']) {
    await page.getByRole('checkbox', { name: `${name} 저녁`, exact: true }).uncheck();
  }
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  const monday = page.getByRole('article', { name: '2026-09-21 저녁 식단' });
  await expect(monday.getByRole('heading', { name: '시금치 리조또', exact: true })).toBeVisible();
  await waitForSave(page);
  await monday.locator('summary').filter({ hasText: /^재료 확인 ·/ }).click();
  await expect(monday.getByRole('list', { name: '2인분 식재료 필요량' }).getByText('360g')).toBeVisible();
  await monday.locator('summary').filter({ hasText: '원문 분량과 대조 근거 보기' }).click();
  await expect(monday.getByText('원문 1인분 · 밥 180g(1컵) · 리조또')).toBeVisible();
  await expect(monday.getByRole('link', { name: '공식 책자 50–51쪽 확인' })).toHaveAttribute('href', /#page=26$/);
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  const preview = page.getByRole('region', { name: '식단 장보기 미리보기' });
  await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  const shortages = preview.getByRole('list', { name: '등록된 재고 기준 추가 필요량', exact: true });
  await expect(shortages.getByRole('listitem')).toHaveCount(1);
  await expect(shortages.getByText('밥', { exact: true })).toBeVisible();
  await expect(shortages.getByText('60g', { exact: true })).toBeVisible();
  await preview.locator('summary').filter({ hasText: '확인이 필요한 재료' }).click();
  await expect(preview.getByText('시금치 데치는 물', { exact: true })).toBeVisible();
  await expect(preview.getByText('미확인 항목이 있어 전체 구매량은 계산되지 않았어요.')).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventory);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reviewed-dinner-mobile.png'), fullPage: true });
  await monday.screenshot({ path: testInfo.outputPath('reviewed-dinner-quantities-mobile.png') });
  await preview.screenshot({ path: testInfo.outputPath('reviewed-dinner-shopping-mobile.png') });

  await page.reload();
  await page.getByLabel('주 시작일').fill('2026-09-21');
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
  await expect(shortages.getByText('60g', { exact: true })).toBeVisible();
  await monday.locator('summary').filter({ hasText: /^재료 확인 ·/ }).click();
  await expect(monday.getByRole('list', { name: '2인분 식재료 필요량' }).getByText('360g')).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventory);
});

for (const candidate of [
  { title: '두유 파스타', exclusions: '밥, 쌀, 소면, 중화면, 토마토, 브로콜리', pages: '40–41', page: 21,
    raw: '원문 1인분 · 두유 400g(2컵) · 소스', ingredient: '두유', amount: '800g', rows: 8,
    waters: ['페투치네 삶는 물'] },
  { title: '채소 자장면', exclusions: '밥, 쌀, 소면, 파스타면', pages: '28–29', page: 15,
    raw: '원문 1인분 · 중화면 200g · 면', ingredient: '중화면', amount: '400g', rows: 13,
    waters: ['검은콩 불리는 물', '완두콩 데치는 물', '중화면 삶는 물', '녹말물에 섞는 물'] },
]) {
  test(`expanded dinner ${candidate.title} preserves source units and all process warnings on mobile reload`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-09-16T03:00:00.000Z'));
    await seedBrowserState(page, { ingredients: [createIngredient('unchanged-apple', {
      name: '사과', quantity: '원본 메모', memo: '수량 추정 금지', expiryDate: '2026-09-30',
    })] });
    // Unreviewed inventory has no quantitative identity and blocks a definitive
    // shortage. Confirm this unrelated stock through the normal UI first.
    await gotoAndWait(page, '/ingredients');
    const stockPanel = page.getByRole('region', { name: '남은 수량 확인', exact: true });
    await stockPanel.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
    const stockForm = stockPanel.getByRole('form', { name: '사과 남은 수량 확인', exact: true });
    await stockForm.getByLabel('확인한 남은 양', { exact: true }).fill('1');
    await stockForm.getByLabel('단위', { exact: true }).selectOption('개');
    await stockForm.getByLabel('조리 상태', { exact: true }).selectOption('raw');
    await stockForm.getByRole('button', { name: '확인한 수량 저장', exact: true }).click();
    await expect(stockForm.getByText('사용자 확인됨', { exact: true })).toBeVisible();
    await gotoAndWait(page, '/meal-plan');
    const before = await readBrowserIngredients(page, 'guest');
    await page.getByLabel('주 시작일').fill('2026-09-21');
    await page.getByLabel('식사 인원').selectOption('2');
    for (const name of ['화요일', '수요일', '목요일', '금요일', '토요일', '일요일']) {
      await page.getByRole('checkbox', { name: `${name} 저녁`, exact: true }).uncheck();
    }
    await page.getByLabel('피하고 싶은 재료').fill(candidate.exclusions);
    await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
    const monday = page.getByRole('article', { name: '2026-09-21 저녁 식단' });
    await expect(monday.getByRole('heading', { name: candidate.title, exact: true })).toBeVisible();
    await waitForSave(page);
    await monday.locator('summary').filter({ hasText: /^재료 확인 ·/ }).click();
    const quantities = monday.getByRole('list', { name: '2인분 식재료 필요량' });
    await expect(quantities.getByRole('listitem')).toHaveCount(candidate.rows);
    await expect(quantities.getByRole('listitem').filter({ hasText: candidate.ingredient }).getByText(candidate.amount, { exact: true })).toBeVisible();
    await monday.locator('summary').filter({ hasText: '원문 분량과 대조 근거 보기' }).click();
    await expect(monday.getByText(candidate.raw, { exact: true })).toBeVisible();
    await expect(monday.getByRole('link', { name: `공식 책자 ${candidate.pages}쪽 확인` })).toHaveAttribute('href', new RegExp(`#page=${candidate.page}$`));
    for (const water of candidate.waters) await expect(monday.getByText(`${water}: 양 확인 필요. 조리 과정에 쓰는 양은 식재료 합계에 넣지 않았어요.`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
    await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
    const preview = page.getByRole('region', { name: '식단 장보기 미리보기' });
    await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
    const shortages = preview.getByRole('list', { name: '등록된 재고 기준 추가 필요량', exact: true });
    await expect(shortages.getByRole('listitem')).toHaveCount(candidate.rows);
    await expect(shortages.getByRole('listitem').filter({ hasText: candidate.ingredient }).getByText(candidate.amount, { exact: true })).toBeVisible();
    await preview.locator('summary').filter({ hasText: '확인이 필요한 재료' }).click();
    for (const water of candidate.waters) await expect(preview.getByText(water, { exact: true })).toBeVisible();
    await expect(preview.getByText('미확인 항목이 있어 전체 구매량은 계산되지 않았어요.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await monday.screenshot({ path: testInfo.outputPath('expanded-dinner-mobile.png') });
    await preview.screenshot({ path: testInfo.outputPath('expanded-dinner-shopping-mobile.png') });
    expect(await readBrowserIngredients(page, 'guest')).toEqual(before);
    await page.reload();
    await page.getByLabel('주 시작일').fill('2026-09-21');
    await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
    await expect(monday.getByRole('heading', { name: candidate.title, exact: true })).toBeVisible();
    await preview.getByRole('button', { name: '식단 장보기 확인', exact: true }).click();
    await expect(shortages.getByRole('listitem').filter({ hasText: candidate.ingredient }).getByText(candidate.amount, { exact: true })).toBeVisible();
    expect(await readBrowserIngredients(page, 'guest')).toEqual(before);
  });
}

test('manual shopping and actual purchase notes survive a changed dinner without receiving inventory', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-09-16T03:00:00.000Z'));
  await seedBrowserState(page, { ingredients: [createIngredient('rice-repurchase', {
    name: '밥', quantity: '기존 재구매 메모', consumed: true, memo: '원본 재고 유지', expiryDate: '2026-09-30',
  })] });
  await gotoAndWait(page, '/meal-plan');
  const inventory = await readBrowserIngredients(page, 'guest');
  await page.getByLabel('주 시작일').fill('2026-09-21');
  await page.getByLabel('식사 인원').selectOption('2');
  for (const name of ['화요일', '수요일', '목요일', '금요일', '토요일', '일요일']) {
    await page.getByRole('checkbox', { name: `${name} 저녁`, exact: true }).uncheck();
  }
  await page.getByLabel('피하고 싶은 재료').fill('파스타면, 소면, 쌀, 중화면, 계란, 두부, 닭고기, 김치, 참치캔, 돼지고기, 소고기');
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  const monday = page.getByRole('article', { name: '2026-09-21 저녁 식단' });
  await expect(monday.getByRole('heading', { name: '시금치 리조또', exact: true })).toBeVisible();
  await waitForSave(page);
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();

  const notes = page.getByRole('region', { name: '장보기 메모', exact: true });
  await notes.getByRole('button', { name: '장보기 메모 열기', exact: true }).click();
  const add = notes.getByRole('form', { name: '수동 장보기 추가', exact: true });
  const checkLayout = await add.getByLabel('장보기 체크', { exact: true }).evaluate((input) => {
    const box = input.getBoundingClientRect();
    const label = input.closest('label').getBoundingClientRect();
    return { width: box.width, height: box.height, targetHeight: label.height };
  });
  expect(checkLayout.width).toBeGreaterThanOrEqual(16);
  expect(checkLayout.width).toBeLessThanOrEqual(24);
  expect(checkLayout.height).toBeGreaterThanOrEqual(16);
  expect(checkLayout.height).toBeLessThanOrEqual(24);
  expect(checkLayout.targetHeight).toBeGreaterThanOrEqual(44);
  await add.getByLabel('품목 이름', { exact: true }).fill('밥');
  await add.getByLabel('필요량 메모', { exact: true }).fill('200g');
  await add.getByLabel('내 메모', { exact: true }).fill('가족 부탁으로 따로 구매');
  await add.getByRole('button', { name: '수동 항목 추가', exact: true }).click();
  await expect(notes.getByText('수동 항목을 저장했어요.', { exact: true })).toBeVisible();
  const manual = notes.getByRole('form', { name: '밥 수동 항목', exact: true });
  await manual.getByLabel('장보기 체크', { exact: true }).check();
  await manual.getByRole('button', { name: '수동 항목 저장', exact: true }).click();
  await expect(manual.getByLabel('장보기 체크', { exact: true })).toBeChecked();
  await expect(manual.getByRole('button', { name: '수동 항목 저장', exact: true })).toBeEnabled();

  const purchase = notes.getByRole('form', { name: '구매 메모 작성', exact: true });
  const sourcePicker = purchase.getByLabel('구매한 품목의 출처', { exact: true });
  await expect(sourcePicker.getByRole('option', { name: '식단: 밥 (360g)', exact: true })).toHaveCount(1);
  await expect(sourcePicker.getByRole('option', { name: '직접 입력: 밥 (200g)', exact: true })).toHaveCount(1);
  await expect(sourcePicker.getByRole('option', { name: '재구매: 밥 (기존 재구매 메모)', exact: true })).toHaveCount(1);
  await sourcePicker.selectOption({ label: '식단: 밥 (360g)' });
  await expect(purchase.getByText('필요량 메모: 360g', { exact: true })).toBeVisible();
  await expect(purchase.getByLabel('실제로 산 양', { exact: true })).toHaveValue('');
  await purchase.getByLabel('실제로 산 양', { exact: true }).fill('500g 한 팩');
  await purchase.getByLabel('구매 메모', { exact: true }).fill('실제 포장 표시');
  await purchase.getByRole('button', { name: '구매 메모 저장', exact: true }).click();
  await expect(notes.getByText('구매 메모를 저장했어요.', { exact: true })).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventory);

  await monday.getByRole('button', { name: '외식·건너뛰기', exact: true }).click();
  await waitForSave(page);
  await page.getByRole('button', { name: '수정 초안으로 확정본 교체', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  await notes.getByRole('button', { name: '장보기 메모 열기', exact: true }).click();
  await expect(manual.getByLabel('장보기 체크', { exact: true })).toBeChecked();
  await expect(manual.getByLabel('내 메모', { exact: true })).toHaveValue('가족 부탁으로 따로 구매');
  await expect(sourcePicker.getByRole('option', { name: /^식단:/ })).toHaveCount(0);
  const history = notes.getByRole('region', { name: '구매 메모 이력', exact: true });
  await expect(history.getByText('식단: 밥', { exact: true })).toBeVisible();
  await expect(history.getByText('실제로 산 양: 500g 한 팩', { exact: true })).toBeVisible();
  await expect(history.getByText('기록 당시 필요량: 360g', { exact: true })).toBeVisible();
  await expect(history.getByText(/재고 미반영/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await notes.screenshot({ path: testInfo.outputPath('shopping-notes-mobile.png') });

  await page.reload();
  await notes.getByRole('button', { name: '장보기 메모 열기', exact: true }).click();
  await expect(manual.getByLabel('장보기 체크', { exact: true })).toBeChecked();
  await expect(history.getByText('실제로 산 양: 500g 한 팩', { exact: true })).toBeVisible();
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventory);
});
