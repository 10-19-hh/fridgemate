import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mealPlanCatalog } from '../src/features/mealPlans/mealPlanCatalog.js';
import { validateLocalMealPlanPilotExport } from '../src/features/mealPlans/mealPlanPilotExport.js';
import { createIngredient, gotoAndWait, readBrowserIngredients, seedBrowserState } from './support/testApp';

const ORIGIN = 'http://127.0.0.1:4283';
const WEEK = '2026-09-28';
const NOW = `${WEEK}T08:00:00.000Z`;
// Approved policy, independent of the implementation's candidate selector.
const CANDIDATES = [
  'mfds-dinner:book2-spinach-risotto', 'mfds-dinner:book2-chilgok-pomegranate-noodles',
  'mfds-dinner:book2-vegetable-jajang-noodles', 'mfds-dinner:book2-soy-drink-pasta',
  'mfds-dinner:book2-potato-rice', 'mfds-dinner:book2-doenjang-bibimbap',
];
const monday = page => page.getByRole('article', { name: `${WEEK} 저녁 식단`, exact: true });
const policy = page => page.getByRole('complementary', { name: '파일럿 메뉴 기준', exact: true });
const saved = page => expect(page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천', exact: true })).toBeEnabled();

async function observeNetwork(page) {
  const state = { forbidden: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.context().route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const remote = /^https?:$/.test(url.protocol) && url.origin !== ORIGIN;
    const trackingHost = ['google-analytics.com', 'googletagmanager.com', 'googlesyndication.com',
      'doubleclick.net', 'googleadservices.com', 'sentry.io'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    const staticAsset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/ocr/tesseract/');
    const dynamicRequest = url.origin === ORIGIN && ['fetch', 'xhr'].includes(request.resourceType()) && !staticAsset;
    // Remote static images/fonts are not analytics. Abort every remote request
    // regardless. Same-origin fetch/XHR must only load explicit static assets;
    // this includes relative auth/API calls without mistaking page navigation
    // (for example /recipes or /login) for a backend request.
    const service = dynamicRequest || url.pathname === '/api' || url.pathname.startsWith('/api/') || trackingHost || (remote
      && !['image', 'font', 'stylesheet', 'media'].includes(request.resourceType()));
    if (service) state.forbidden.push({ origin: url.origin, path: url.pathname, type: request.resourceType() });
    if (remote || service) await route.abort();
    else await route.continue();
  });
  return state;
}

async function expectSafePage(page, observation) {
  expect(observation.forbidden).toEqual([]);
  expect(observation.errors).toEqual([]);
  expect(new URL(page.url()).origin).toBe(ORIGIN);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function readState(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('fridgemate-db__guest');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['mealPlans', 'mealPlanPilot', 'inventoryEvents', 'shoppingEntries'], 'readonly');
      const plans = tx.objectStore('mealPlans').getAll();
      const pilot = tx.objectStore('mealPlanPilot').get('session');
      const events = tx.objectStore('inventoryEvents').getAll();
      const shopping = tx.objectStore('shoppingEntries').getAll();
      tx.oncomplete = () => { db.close(); resolve({ plans: plans.result, pilot: pilot.result, events: events.result, shopping: shopping.result }); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

async function openPlanner(page) {
  await gotoAndWait(page, '/meal-plan');
  await expect(policy(page)).toBeVisible();
  await expect(policy(page)).toContainText('파일럿 참여 동의와 관계없이');
  await expect(page.getByRole('button', { name: '한 주 식단 만들기', exact: true })).toBeEnabled();
}

function expectPilotCandidates(plan) {
  const planned = plan.slots.filter(slot => slot.status === 'planned');
  expect(planned.length).toBeGreaterThan(0);
  for (const slot of planned) {
    expect(CANDIDATES).toContain(slot.templateKey);
    const processInputs = slot.components.flatMap(component => component.processInputs || []);
    expect(processInputs.length).toBeGreaterThan(0);
    for (const input of processInputs) expect(input).toMatchObject({ amount: null, unit: null, quantityStatus: 'unverified' });
  }
}

test('pilot menus stay conditional without analytics consent through generation, replacement, locking and reload', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 390, height: 844 });
  const observation = await observeNetwork(page);
  const ingredients = [createIngredient('synthetic-rice', { name: '밥', quantity: '2공기', expiryDate: '2026-10-10' })];
  await seedBrowserState(page, { ingredients, analyticsConsent: 'denied' });
  await openPlanner(page);
  const originalInventory = await readBrowserIngredients(page, 'guest');
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await saved(page);
  const initial = await readState(page);
  expect(initial.pilot).toBeUndefined();
  expectPilotCandidates(initial.plans[0].draft);
  await monday(page).locator('summary').first().click();
  await expect(monday(page).getByRole('note', { name: '메뉴 검수 범위' })).toContainText('모든 조리 투입량의 검수는 아니에요');
  await expect(monday(page)).toContainText('양 확인 필요');
  await page.screenshot({ path: testInfo.outputPath('pilot-quantity-details-mobile.png'), fullPage: true });
  const title = await monday(page).getByRole('heading', { level: 3 }).textContent();
  await monday(page).getByRole('combobox', { name: '교체·건너뛰기 이유 (선택)', exact: true }).selectOption('taste');
  await monday(page).getByRole('button', { name: '메뉴 교체', exact: true }).click();
  await saved(page);
  await expect(monday(page).getByRole('heading', { level: 3 })).not.toHaveText(title);
  expectPilotCandidates((await readState(page)).plans[0].draft);
  await monday(page).getByRole('button', { name: '메뉴 고정', exact: true }).click();
  await saved(page);
  const locked = (await readState(page)).plans[0].draft.slots[0];
  await page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천', exact: true }).click();
  await saved(page);
  const regenerated = (await readState(page)).plans[0].draft;
  expectPilotCandidates(regenerated);
  expect(regenerated.slots[0].components).toEqual(locked.components);
  expect(regenerated.slots[0]).toMatchObject({ templateKey: locked.templateKey, locked: true });
  await page.reload();
  await expect(monday(page).getByRole('button', { name: '고정 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await readState(page)).plans[0].draft).toEqual(regenerated);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(originalInventory);
  expect((await readState(page)).pilot).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-analytics-consent'))).toBe('denied');
  await expectSafePage(page, observation);
  await page.screenshot({ path: testInfo.outputPath('pilot-candidates-mobile.png'), fullPage: true });
});

test('optional reasons survive real saved actions and explicit JSON export without changing inventory or analytics consent', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 390, height: 844 });
  const observation = await observeNetwork(page);
  await seedBrowserState(page);
  await gotoAndWait(page, '/pilot');
  await page.getByRole('checkbox', { name: '이 기기에 식단 파일럿 기록을 저장하는 데 동의해요' }).check();
  await page.getByRole('button', { name: '동의하고 기록 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '파일럿 기록 내려받기', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '주간 식단', exact: true }).click();
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await saved(page);
  const reason = monday(page).getByRole('combobox', { name: '교체·건너뛰기 이유 (선택)', exact: true });
  await page.clock.setFixedTime(new Date(`${WEEK}T08:01:00.000Z`));
  await reason.focus();
  await expect(reason).toBeFocused();
  await reason.selectOption('repetition');
  await expect(reason).toHaveValue('repetition');
  await page.screenshot({ path: testInfo.outputPath('pilot-reason-mobile.png'), fullPage: true });
  const replace = monday(page).getByRole('button', { name: '메뉴 교체', exact: true });
  await replace.focus();
  await page.keyboard.press('Enter');
  await saved(page);
  await expect(replace).toBeFocused();
  await expect(reason).toHaveValue('');
  await page.clock.setFixedTime(new Date(`${WEEK}T08:02:00.000Z`));
  const tuesday = page.getByRole('article', { name: '2026-09-29 저녁 식단', exact: true });
  await tuesday.getByRole('button', { name: '외식·건너뛰기', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('식단을 확정했어요.', { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-09-29T03:00:00.000Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(monday(page).getByRole('button', { name: '만들지 않았어요', exact: true })).toBeVisible();
  await reason.selectOption('schedule');
  await monday(page).getByRole('button', { name: '만들지 않았어요', exact: true }).click();
  await saved(page);
  expect((await readState(page)).plans[0].confirmed.slots[0].status).toBe('planned');
  expect((await readState(page)).plans[0].draft.slots[0].status).toBe('skipped');
  await page.getByRole('button', { name: '수정 초안으로 확정본 교체', exact: true }).click();
  await expect(page.getByText('식단을 확정했어요.', { exact: true })).toBeVisible();
  const plans = (await readState(page)).plans;
  expect(JSON.stringify(plans)).not.toMatch(/reasonCode|changeType/);
  await page.getByRole('link', { name: '식단 파일럿', exact: true }).click();
  await expect(page.getByRole('button', { name: '파일럿 기록 내려받기', exact: true })).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'),
    page.getByRole('button', { name: '파일럿 기록 내려받기', exact: true }).click()]);
  const exported = validateLocalMealPlanPilotExport(JSON.parse(await readFile(await download.path(), 'utf8')));
  expect(exported.dataset.events.filter(event => event.version === 2).map(({ changeType, reasonCode }) => ({ changeType, reasonCode })))
    .toEqual([{ changeType: 'replace', reasonCode: 'repetition' }, { changeType: 'skip', reasonCode: 'not_answered' },
      { changeType: 'not_cooked', reasonCode: 'schedule' }]);
  expect(exported.dataset.events.some(event => event.name === 'meal_cooked_recorded')).toBe(false);
  expect(JSON.stringify(exported)).not.toMatch(/week:|:dinner|templateKey|recipeId|ingredientId/);
  await page.getByRole('button', { name: '참여 철회 및 기록 삭제', exact: true }).click();
  await page.getByRole('button', { name: '철회 및 삭제 확인', exact: true }).click();
  await expect(page.getByText('현재 참여하지 않고 있어요. 새 동의는 이전 기록을 복원하지 않아요.', { exact: true })).toBeVisible();
  expect((await readState(page)).pilot).not.toHaveProperty('events');
  expect((await readState(page)).plans).toEqual(plans);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-analytics-consent'))).toBe('denied');
  await expectSafePage(page, observation);
});

function previousEditorialRecord() {
  // Synthetic saved state using the existing source rows, not a real user's DB.
  const source = mealPlanCatalog.find(item => item.key === 'local-meal:kimchi-rice');
  const plan = {
    id: `week:${WEEK}`, schemaVersion: 1, scope: 'guest', weekStart: WEEK, revision: 1,
    createdAt: NOW, updatedAt: NOW, preferences: { servings: 1, excludedIngredients: [], dinnerDays: [0, 1] },
    slots: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.parse(`${WEEK}T12:00:00.000Z`) + index * 86400000).toISOString().slice(0, 10);
      return { id: `${date}:dinner`, date, mealType: 'dinner', status: index < 2 ? 'planned' : 'skipped', locked: index === 0,
        servings: 1, templateKey: source.key, templateVersion: source.version, title: source.title,
        reason: '합성 이전 편집 조합 기록', notice: null, catalogVersion: source.catalogVersion,
        foodGroupRuleVersion: source.foodGroupRuleVersion, foodGroups: structuredClone(source.foodGroups),
        components: structuredClone(source.components) };
    }),
  };
  return { id: plan.id, schemaVersion: 2, scope: 'guest', weekStart: WEEK, revision: 1,
    createdAt: NOW, updatedAt: NOW, draft: null, confirmed: plan, archives: [] };
}

test('pilot build reads an older editorial plan without migration and preserves its locked source when regenerating', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  const observation = await observeNetwork(page);
  await seedBrowserState(page);
  await openPlanner(page);
  const original = previousEditorialRecord();
  await page.evaluate(record => new Promise((resolve, reject) => {
    const request = indexedDB.open('fridgemate-db__guest');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('mealPlans', 'readwrite');
      tx.objectStore('mealPlans').put(record);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), original);
  await page.reload();
  await expect(monday(page).getByRole('heading', { level: 3 })).toHaveText('김치볶음밥');
  expect((await readState(page)).plans).toEqual([original]);
  await monday(page).locator('summary').first().click();
  await expect(monday(page).getByRole('note', { name: '메뉴 검수 범위' })).toHaveText('편집 조합 · 인분과 식재료량 미검수');
  await page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천', exact: true }).click();
  await saved(page);
  const changed = (await readState(page)).plans[0];
  expect(changed.confirmed).toEqual(original.confirmed);
  expect(changed.draft.slots[0]).toEqual(original.confirmed.slots[0]);
  expect(CANDIDATES).toContain(changed.draft.slots[1].templateKey);
  await page.reload();
  await expect(monday(page).getByRole('button', { name: '고정 해제', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await readState(page)).plans[0]).toEqual(changed);
  expect((await readState(page)).events).toEqual([]);
  expect((await readState(page)).shopping).toEqual([]);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  await expectSafePage(page, observation);
});

test('the same pilot origin retains consent and plans across reload and exports only on explicit download', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 390, height: 844 });
  const observation = await observeNetwork(page);
  await seedBrowserState(page);
  await gotoAndWait(page, '/pilot');
  const consent = page.getByRole('checkbox', { name: '이 기기에 식단 파일럿 기록을 저장하는 데 동의해요' });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole('button', { name: '동의하고 기록 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '파일럿 기록 내려받기', exact: true })).toBeEnabled();
  const original = (await readState(page)).pilot;
  await page.getByRole('link', { name: '주간 식단', exact: true }).click();
  await expect(policy(page)).toBeVisible();
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('식단을 확정했어요.', { exact: true })).toBeVisible();
  const confirmed = (await readState(page)).plans;
  expectPilotCandidates(confirmed[0].confirmed);
  await page.getByRole('link', { name: '식단 파일럿', exact: true }).click();
  await expect(page.getByRole('button', { name: '파일럿 기록 내려받기', exact: true })).toBeEnabled();
  await page.clock.setFixedTime(new Date(`${WEEK}T09:00:00.000Z`));
  await page.reload();
  await expect(page.getByRole('button', { name: '앞으로 기록 재개', exact: true })).toBeEnabled();
  const reloaded = await readState(page);
  expect(reloaded.plans).toEqual(confirmed);
  expect(reloaded.pilot).toMatchObject({ version: original.version, subjectId: original.subjectId,
    startedAt: original.startedAt, expiresAt: original.expiresAt });
  await page.getByRole('button', { name: '앞으로 기록 재개', exact: true }).click();
  await expect(page.getByRole('button', { name: '앞으로 기록 재개', exact: true })).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download'),
    page.getByRole('button', { name: '파일럿 기록 내려받기', exact: true }).click()]);
  const exported = validateLocalMealPlanPilotExport(JSON.parse(await readFile(await download.path(), 'utf8')));
  expect(exported).toMatchObject({ measurementUnit: 'browser-scope', startedAt: original.startedAt, expiresAt: original.expiresAt });
  expect(exported.dataset.subjects[0]).toMatchObject({ id: original.subjectId, firstGenerationKnown: false });
  expect(exported.dataset.events.map(event => event.name)).toEqual(expect.arrayContaining(['meal_plan_generated', 'meal_plan_confirmed']));
  expect(exported.dataset.subjects[0].gaps).toEqual([{ from: NOW, through: `${WEEK}T09:00:00.000Z`, reason: 'missing' }]);
  expect(JSON.stringify(exported)).not.toMatch(/"scope"|week:|:dinner|requestKey|sourceToken|recipeId|ingredientId/);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-analytics-consent'))).toBe('denied');
  expect((await readState(page)).plans).toEqual(confirmed);
  await expectSafePage(page, observation);
});

test('synthetic session and analytics approval cannot enable backend or tracking in the pilot artifact', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 390, height: 844 });
  const observation = await observeNetwork(page);
  await seedBrowserState(page, { analyticsConsent: 'granted', session: { user: { id: 'synthetic-pilot-user', email: 'pilot@example.test' } } });
  await page.evaluate(() => localStorage.setItem('fridgemate-auth-session-present:v1', '1'));
  await gotoAndWait(page, '/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectSafePage(page, observation);
  await gotoAndWait(page, '/login');
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeDisabled();
  await expect(page.getByText('현재는 로컬 전용 모드여서 로그인 기능을 사용할 수 없어요.')).toBeVisible();
  await expectSafePage(page, observation);
  for (const route of ['/account', '/recipes', '/ingredients/new', '/import', '/pilot']) {
    await gotoAndWait(page, route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectSafePage(page, observation);
  }
  await openPlanner(page);
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await saved(page);
  expectPilotCandidates((await readState(page)).plans[0].draft);
  expect(await page.locator('script[data-fridgemate-ga], script[src*="googlesyndication"], meta[name="google-adsense-account"]').count()).toBe(0);
  await expectSafePage(page, observation);
});

test('synthetic unknown-usage cooking reaches the explicit pilot JSON export without inventory deduction', async ({ page }) => {
  // Synthetic browser scenario only: no participant data or measured stock is
  // supplied, and the real UI/repository/collector perform every business write.
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 390, height: 844 });
  const observation = await observeNetwork(page);
  const privateMemo = 'synthetic-private-note pilot-cooking@example.test';
  await seedBrowserState(page, { analyticsConsent: 'denied', ingredients: [
    createIngredient('synthetic-pilot-cooking-stock', {
      name: '밥', quantity: '2공기', expiryDate: '2026-10-10', memo: privateMemo,
    }),
  ] });
  await gotoAndWait(page, '/pilot');
  const originalInventory = await readBrowserIngredients(page, 'guest');
  await page.getByRole('checkbox', { name: '이 기기에 식단 파일럿 기록을 저장하는 데 동의해요' }).check();
  await page.getByRole('button', { name: '동의하고 기록 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '파일럿 기록 내려받기', exact: true })).toBeEnabled();
  await page.clock.setFixedTime(new Date(`${WEEK}T08:01:00.000Z`));
  await page.reload();
  await page.getByRole('button', { name: '앞으로 기록 재개', exact: true }).click();
  await expect(page.getByRole('button', { name: '앞으로 기록 재개', exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: '주간 식단', exact: true }).click();
  await expect(policy(page)).toBeVisible();
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await saved(page);
  expectPilotCandidates((await readState(page)).plans[0].draft);
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('식단을 확정했어요.', { exact: true })).toBeVisible();
  expectPilotCandidates((await readState(page)).plans[0].confirmed);

  const title = await monday(page).getByRole('heading', { level: 3 }).textContent();
  await monday(page).getByRole('button', { name: '만들어 먹었어요', exact: true }).click();
  const panel = page.getByRole('region', { name: '조리와 재고 기록', exact: true });
  const form = panel.getByRole('form', { name: `조리 사용량 · ${title}`, exact: true });
  await expect(form.getByRole('spinbutton')).toHaveCount(0);
  await expect(form.getByRole('button', { name: '실제 사용량으로 조리 기록', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: '사용량 없이 조리만 기록', exact: true }).click();
  await expect(panel.getByText('조리만 기록했어요. 남은 재고량을 다시 확인해 주세요.', { exact: true })).toBeVisible();
  await expect(monday(page).getByText('조리 기록됨', { exact: true })).toBeVisible();
  const cooked = await readState(page);
  expect(cooked.plans[0].confirmed.slots[0]).toMatchObject({ status: 'cooked',
    cooking: { inventoryStatus: 'needs-review', consumptionId: null } });
  expect(cooked.events).toEqual([expect.objectContaining({ kind: 'cooking', slotId: `${WEEK}:dinner`,
    inventoryStatus: 'needs-review', consumptionId: null })]);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(originalInventory);
  await panel.getByRole('button', { name: '조리 창 닫기', exact: true }).click();

  await page.getByRole('link', { name: '식단 파일럿', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'),
    page.getByRole('button', { name: '파일럿 기록 내려받기', exact: true }).click()]);
  const exported = validateLocalMealPlanPilotExport(JSON.parse(await readFile(await download.path(), 'utf8')));
  expect(exported.dataset.events.filter(event => event.name === 'meal_cooked_recorded')).toEqual([
    expect.objectContaining({ version: 1, status: 'success', weekKey: WEEK }),
  ]);
  expect(exported.dataset.events.map(event => event.name)).toEqual(expect.arrayContaining([
    'meal_plan_generated', 'meal_plan_confirmed', 'meal_cooked_recorded',
  ]));
  expect(exported.dataset.events.some(event => event.name === 'consumption_applied')).toBe(false);
  const serialized = JSON.stringify(exported);
  expect(serialized).not.toContain(privateMemo);
  expect(serialized).not.toContain('synthetic-pilot-cooking-stock');
  expect(serialized).not.toContain(title);
  expect(serialized).not.toMatch(/"scope"|week:|:dinner|requestKey|sourceToken|templateKey|recipeId|ingredientId|rawName|normalizedName|memo|email/);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(originalInventory);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-analytics-consent'))).toBe('denied');
  await expectSafePage(page, observation);
});
