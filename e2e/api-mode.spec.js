import { expect, test } from '@playwright/test';
import {
  createIngredient,
  DEFAULT_USER,
  gotoAndWait,
  mockApiSession,
  seedBrowserState,
  waitForIngredientNames
} from './support/testApp';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6OZsAAAAASUVORK5CYII=',
  'base64'
);

test('leaving account cancels a pending browser download and a fresh export still works', async ({ page }) => {
  await seedBrowserState(page, { session: { user: DEFAULT_USER } });
  await mockApiSession(page, { user: DEFAULT_USER, restoreSession: true });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let received;
  const requestReceived = new Promise(resolve => { received = resolve; });
  const requests = [];
  const downloads = [];
  page.on('download', item => downloads.push(item.suggestedFilename()));
  await page.route('**/api/auth/data-export', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) { received(); await pending; }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-fixture-export': '1' },
      body: JSON.stringify({ schemaVersion: 2, generatedAt: '2026-09-28T00:00:00.000Z', account: DEFAULT_USER,
        ingredients: [], importCorrections: [], recommendationEvents: [], menuDecisions: [],
        pantryOwnerships: [], preference: null, productEvents: [] }) });
  });
  await gotoAndWait(page, '/account');
  await page.evaluate(() => {
    const original = Response.prototype.json;
    Response.prototype.json = async function (...args) {
      const body = await original.apply(this, args);
      if (this.headers.get('x-fixture-export') === '1') {
        setTimeout(() => { window.__FRIDGEMATE_TEST__.exportBodyRead = true; }, 0);
      }
      return body;
    };
  });
  await page.getByLabel('내려받기 전 현재 비밀번호 확인').fill('fixture-old-password');
  await page.getByRole('button', { name: '내 데이터 내려받기', exact: true }).click();
  await requestReceived;
  await page.getByRole('navigation').getByRole('link', { name: '메뉴 추천', exact: true }).click();
  await expect(page).toHaveURL(/\/recipes$/);
  release();
  await page.waitForFunction(() => window.__FRIDGEMATE_TEST__.exportBodyRead === true);
  expect(downloads).toEqual([]);
  await page.getByRole('link', { name: '계정', exact: true }).click();
  await expect(page.getByLabel('내려받기 전 현재 비밀번호 확인')).toHaveValue('');
  await page.getByLabel('내려받기 전 현재 비밀번호 확인').fill('fixture-new-password');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '내 데이터 내려받기', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^fridgemate-data-\d{4}-\d{2}-\d{2}\.json$/);
  expect(downloads).toHaveLength(1);
  expect(requests).toEqual([{ password: 'fixture-old-password' }, { password: 'fixture-new-password' }]);
  await expect(page.getByLabel('내려받기 전 현재 비밀번호 확인')).toHaveValue('');
});

test('a late login acknowledgement does not redirect a different lazy page', async ({ page }) => {
  await seedBrowserState(page);
  await mockApiSession(page, { user: DEFAULT_USER });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let received;
  const requestReceived = new Promise(resolve => { received = resolve; });
  let calls = 0;
  await page.route('**/api/auth/login', async route => {
    calls += 1;
    received();
    await pending;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-fixture-login': '1' },
      body: JSON.stringify({ user: DEFAULT_USER }) });
  });
  await gotoAndWait(page, '/login');
  await page.evaluate(() => {
    const original = Response.prototype.json;
    Response.prototype.json = async function (...args) {
      const body = await original.apply(this, args);
      if (this.headers.get('x-fixture-login') === '1') {
        setTimeout(() => { window.__FRIDGEMATE_TEST__.loginBodyRead = true; }, 0);
      }
      return body;
    };
  });
  await page.getByLabel('이메일').fill(DEFAULT_USER.email);
  await page.getByLabel('비밀번호', { exact: true }).fill('fixture-password!');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await requestReceived;
  await page.getByRole('navigation').getByRole('link', { name: '메뉴 추천', exact: true }).click();
  await expect(page).toHaveURL(/\/recipes$/);
  release();
  await page.waitForFunction(() => window.__FRIDGEMATE_TEST__.loginBodyRead === true);
  await expect(page.getByRole('heading', { name: '남은 재료를 골라 조리법까지 살펴보세요' })).toBeVisible();
  await expect(page.getByRole('link', { name: '계정', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/recipes$/);
  expect(calls).toBe(1);
});

test('same-tick login submissions make one request and retain the protected return route', async ({ page }) => {
  await seedBrowserState(page);
  await mockApiSession(page, { user: DEFAULT_USER });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let received;
  const requestReceived = new Promise(resolve => { received = resolve; });
  let calls = 0;
  await page.route('**/api/auth/login', async route => {
    calls += 1;
    received();
    await pending;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: DEFAULT_USER }) });
  });
  await gotoAndWait(page, '/account');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('이메일').fill(DEFAULT_USER.email);
  await page.getByLabel('비밀번호', { exact: true }).fill('fixture-password!');
  await page.getByRole('button', { name: '로그인', exact: true }).evaluate(button => {
    const form = button.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await requestReceived;
  await expect(page.getByRole('button', { name: '로그인 중...' })).toBeDisabled();
  release();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: DEFAULT_USER.email, exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

for (const nextUser of [{ id: 'user-2', email: 'second@example.com' }, DEFAULT_USER]) {
  test(`an old preference 401 is not replayed after logout and login as ${nextUser.id}`, async ({ page }) => {
    await seedBrowserState(page, { session: { user: DEFAULT_USER } });
    await mockApiSession(page, { user: DEFAULT_USER, restoreSession: true });
    let currentUser = DEFAULT_USER;
    const defaults = { preferredIngredients: [], dislikedIngredients: [], spiceLevel: 'medium', cookingTimePreference: 'flexible' };
    const writes = [];
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let received;
    const requestReceived = new Promise(resolve => { received = resolve; });
    await page.route('**/api/auth/refresh', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: currentUser }) }));
    await page.route('**/api/auth/login', route => {
      currentUser = nextUser;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: nextUser }) });
    });
    await page.route('**/api/user-preferences', async route => {
      if (route.request().method() === 'PUT') {
        writes.push({ userId: currentUser.id, body: route.request().postDataJSON() });
        if (writes.length === 1) {
          received();
          await pending;
          await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Fixture expired first request' }) });
          return;
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(defaults) });
    });
    await gotoAndWait(page, '/account');
    await page.getByLabel('선호 재료', { exact: true }).fill('두부');
    await page.getByRole('button', { name: '취향 저장', exact: true }).click();
    await requestReceived;
    const logoutFinished = page.waitForResponse(item => new URL(item.url()).pathname === '/api/auth/logout');
    await page.getByRole('main').getByRole('button', { name: '로그아웃', exact: true }).click();
    await logoutFinished;
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('이메일').fill(nextUser.email);
    await page.getByLabel('비밀번호').fill('password123');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page.getByRole('heading', { name: nextUser.email, exact: true })).toBeVisible();
    const oldResponse = page.waitForResponse(item => item.request().method() === 'PUT' && new URL(item.url()).pathname === '/api/user-preferences');
    release();
    await oldResponse;
    await page.waitForLoadState('networkidle');
    expect(writes).toEqual([{ userId: DEFAULT_USER.id, body: { ...defaults, preferredIngredients: ['두부'] } }]);
    await expect(page.getByRole('heading', { name: nextUser.email, exact: true })).toBeVisible();
    await expect(page.getByLabel('선호 재료', { exact: true })).toHaveValue('');
  });
}

test('preference quota failure clears success feedback and retries without losing saved choices', async ({ page }, testInfo) => {
  await seedBrowserState(page, { session: { token: 'test-token', user: DEFAULT_USER } });
  await mockApiSession(page, { user: DEFAULT_USER, restoreSession: true });
  let writes = 0;
  const stored = { preferredIngredients: [], dislikedIngredients: [], spiceLevel: 'medium', cookingTimePreference: 'flexible' };
  await page.route('**/api/user-preferences', async route => {
    if (route.request().method() === 'PUT') {
      writes += 1;
      Object.assign(stored, route.request().postDataJSON());
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoAndWait(page, '/account');
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '자주 찾는 재료와 피하고 싶은 재료' }) });
  await panel.getByLabel('선호 재료', { exact: true }).fill('두부');
  await panel.getByRole('button', { name: '취향 저장', exact: true }).click();
  await expect(panel.getByText('취향 설정을 저장했습니다.', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'fridgemate-user-preferences:v1:user:user-1') {
        throw new DOMException('Fixture full storage', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
    window.__FRIDGEMATE_TEST__.restorePreferenceWrite = () => { Storage.prototype.setItem = original; };
  });
  await panel.getByLabel('매운맛').selectOption('mild');
  await expect(panel.getByRole('alert')).toContainText(/저장하지 못/);
  await expect(panel.getByText('취향 설정을 저장했습니다.', { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('매운맛')).toHaveValue('medium');
  await panel.getByLabel('선호 재료', { exact: true }).fill('두부, 버섯');
  await panel.getByRole('button', { name: '취향 저장', exact: true }).click();
  await expect(panel.getByLabel('선호 재료', { exact: true })).toHaveValue('두부, 버섯');
  await expect(panel.getByRole('alert')).toContainText(/저장하지 못/);
  expect(writes).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fridgemate-user-preferences:v1:user:user-1'))))
    .toEqual({ preferredIngredients: ['두부'], dislikedIngredients: [], spiceLevel: 'medium', cookingTimePreference: 'flexible' });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('preference-storage-failure-desktop.png') });
  await page.evaluate(() => window.__FRIDGEMATE_TEST__.restorePreferenceWrite());
  await panel.getByRole('button', { name: '취향 저장', exact: true }).click();
  await expect(panel.getByText('취향 설정을 저장했습니다.', { exact: true })).toBeVisible();
  expect(writes).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fridgemate-user-preferences:v1:user:user-1'))))
    .toEqual({ preferredIngredients: ['두부', '버섯'], dislikedIngredients: [], spiceLevel: 'medium', cookingTimePreference: 'flexible' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(panel.getByLabel('선호 재료', { exact: true })).toHaveValue('두부, 버섯');
  expect(errors).toEqual([]);
});

test('late preference acknowledgement cannot recreate data cleared by secure logout', async ({ page }) => {
  await seedBrowserState(page, { session: { token: 'test-token', user: DEFAULT_USER } });
  await mockApiSession(page, { user: DEFAULT_USER, restoreSession: true });
  const defaults = { preferredIngredients: [], dislikedIngredients: [], spiceLevel: 'medium', cookingTimePreference: 'flexible' };
  let acknowledge;
  const pending = new Promise(resolve => { acknowledge = resolve; });
  let received;
  const requestReceived = new Promise(resolve => { received = resolve; });
  await page.route('**/api/user-preferences', async route => {
    const body = route.request().method() === 'PUT' ? route.request().postDataJSON() : defaults;
    if (route.request().method() === 'PUT') { received(); await pending; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body),
      headers: route.request().method() === 'PUT' ? { 'x-fixture-late-put': '1' } : {} });
  });
  await gotoAndWait(page, '/account');
  await page.getByLabel('선호 재료', { exact: true }).fill('두부');
  await page.getByRole('button', { name: '취향 저장', exact: true }).click();
  await requestReceived;
  await expect(page.getByRole('button', { name: '저장 중...' })).toBeDisabled();
  page.once('dialog', dialog => dialog.accept());
  const logoutFinished = page.waitForResponse(item => new URL(item.url()).pathname === '/api/auth/logout');
  await page.getByRole('button', { name: '이 기기 데이터도 지우고 로그아웃', exact: true }).click();
  await logoutFinished;
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-user-preferences:v1:user:user-1'))).toBeNull();
  await page.evaluate(() => {
    const original = Response.prototype.json;
    Response.prototype.json = async function (...args) {
      const body = await original.apply(this, args);
      if (this.headers.get('x-fixture-late-put') === '1') {
        setTimeout(() => {
          window.__FRIDGEMATE_TEST__.preferenceAcknowledged = true;
          Response.prototype.json = original;
        }, 0);
      }
      return body;
    };
  });
  const response = page.waitForResponse(item => item.request().method() === 'PUT'
    && new URL(item.url()).pathname === '/api/user-preferences');
  acknowledge();
  await response;
  // Observe body consumption and the following browser task, not merely response headers.
  await page.waitForFunction(() => window.__FRIDGEMATE_TEST__.preferenceAcknowledged === true);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-user-preferences:v1:user:user-1'))).toBeNull();
  await expect(page).toHaveURL(/\/login$/);
});

async function clickServerBackupButton(page) {
  const backupButton = page.getByRole('button', { name: '서버에 백업하기' });
  await expect(backupButton).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await backupButton.click();
}

test('protected account route redirects to login and returns after successful login', async ({ page }) => {
  await seedBrowserState(page);
  await mockApiSession(page, { user: DEFAULT_USER });
  await gotoAndWait(page, '/account');

  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('이메일').fill('user@example.com');
  await page.getByLabel('비밀번호').fill('password123');
  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'user@example.com' })).toBeVisible();
});

test('authenticated API mode saves a new ingredient locally until manual sync', async ({ page }) => {
  await seedBrowserState(page, {
    session: {
      token: 'test-token',
      user: DEFAULT_USER
    }
  });
  await mockApiSession(page, { user: DEFAULT_USER, restoreSession: true });
  await gotoAndWait(page, '/ingredients/new');

  await page.getByLabel('이름').fill('두부');
  await page.getByLabel('수량').fill('1모');
  await page.getByLabel('카테고리').selectOption('간편식');
  await page.getByLabel('보관 방식').selectOption('냉장');
  await page.getByRole('button', { name: '재료 추가' }).click();

  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByRole('heading', { name: '두부' })).toBeVisible();

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: '두부' })).toBeVisible();
});

test('guest ingredients can be imported after login and synced manually', async ({ page }) => {
  const apiState = await mockApiSession(page, { user: DEFAULT_USER });

  await seedBrowserState(page);
  await gotoAndWait(page, '/ingredients/new');

  await page.getByLabel('이름').fill('감자');
  await page.getByLabel('수량').fill('3개');
  await page.getByLabel('카테고리').selectOption('채소');
  await page.getByLabel('보관 방식').selectOption('상온');
  await page.getByRole('button', { name: '재료 추가' }).click();

  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByRole('heading', { name: '감자' })).toBeVisible();
  expect(apiState.ingredients).toEqual([]);

  await gotoAndWait(page, '/login');
  await page.getByLabel('이메일').fill('user@example.com');
  await page.getByLabel('비밀번호').fill('password123');
  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText('게스트 모드에서 1개의 재료를 찾았어요.')).toBeVisible();
  await page.getByRole('button', { name: '게스트 재료 가져오기' }).click();
  await expect(page.getByText('동기화되지 않은 변경사항').locator('..').getByText('있습니다')).toBeVisible();
  await waitForIngredientNames(page, 'user:user-1', ['감자']);

  await clickServerBackupButton(page);
  await expect(page.getByText('로컬 변경사항을 서버와 병합했습니다.')).toBeVisible();
  expect(apiState.ingredients.map((ingredient) => ingredient.name)).toContain('감자');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await gotoAndWait(page, '/ingredients');
  await expect(page.getByRole('heading', { name: '감자' })).toBeVisible();

  await page.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByRole('heading', { name: '감자' })).toHaveCount(0);
  await waitForIngredientNames(page, 'user:user-1', []);
  expect(apiState.ingredients.map((ingredient) => ingredient.name)).toContain('감자');

  await gotoAndWait(page, '/account');
  await clickServerBackupButton(page);
  await expect(page.getByText('로컬 변경사항을 서버와 병합했습니다.')).toBeVisible();
  expect(apiState.ingredients.filter((ingredient) => !ingredient.deletedAt).map((ingredient) => ingredient.name)).not.toContain(
    '감자'
  );
  expect(apiState.ingredients).toEqual([
    {
      id: expect.any(String),
      clientId: expect.any(String),
      updatedAt: expect.any(String),
      deletedAt: expect.any(String)
    }
  ]);
});

test('menu selection keeps a pending copy after 5xx and succeeds on explicit retry', async ({ page }) => {
  await seedBrowserState(page, {
    session: { token: 'test-token', user: DEFAULT_USER },
    scope: 'user:user-1',
    ingredients: [createIngredient('egg-1', { name: '계란', expiryDate: '2026-09-02' })]
  });
  const apiState = await mockApiSession(page, { user: DEFAULT_USER, restoreSession: true });
  apiState.backend.menuDecisionFailureStatus = 503;
  await gotoAndWait(page, '/recipes');

  const firstCard = page.locator('article').filter({ has: page.getByRole('button', { name: '오늘 먹기' }) }).first();
  // A full navigation must not interrupt the local write or the simulated 5xx request.
  const failedSave = page.waitForResponse((response) =>
    response.request().method() === 'PUT'
    && new URL(response.url()).pathname.startsWith('/api/menu-decisions/')
    && response.status() === 503
  );
  await firstCard.getByRole('button', { name: '오늘 먹기' }).click();
  await failedSave;
  await expect(page.getByRole('button', { name: '선택됨' }).first()).toBeVisible();
  await gotoAndWait(page, '/');
  await expect(page.getByRole('button', { name: '서버 저장 다시 시도' })).toBeVisible({
    timeout: 10_000
  });

  apiState.backend.menuDecisionFailureStatus = null;
  await page.getByRole('button', { name: '서버 저장 다시 시도' }).click();
  await expect(page.getByRole('button', { name: '서버 저장 다시 시도' })).toHaveCount(0);
  expect(apiState.backend.menuDecision).toMatchObject({ status: 'selected', userId: 'user-1' });
});

test('expired session clears stored auth and returns to login', async ({ page }) => {
  await seedBrowserState(page, {
    session: {
      token: 'test-token',
      user: DEFAULT_USER
    }
  });

  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'The current session is no longer valid.' })
    })
  );

  await gotoAndWait(page, '/account');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.evaluate(() => window.localStorage.getItem('fridgemate-auth-session'))).resolves.toBeNull();
});

test('temporary session verification failure locks the user cache instead of restoring stale identity', async ({ page }) => {
  await seedBrowserState(page, {
    session: {
      token: 'test-token',
      user: DEFAULT_USER
    },
    scope: 'user:user-1',
    ingredients: [createIngredient('cached-private-1', { name: '개인용 김치', syncState: 'clean' })]
  });

  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Temporary outage.' })
    })
  );

  await gotoAndWait(page, '/account');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/안전을 위해 로그아웃했습니다/)).toBeVisible();
  await expect(page.evaluate(() => window.localStorage.getItem('fridgemate-auth-session'))).resolves.toBeNull();

  await gotoAndWait(page, '/ingredients');
  await expect(page.getByRole('heading', { name: '개인용 김치' })).toHaveCount(0);
});

test('failed server logout stays fenced across a reload and never refreshes the old session', async ({ page }) => {
  await page.addInitScript((session) => {
    const seedKey = '__fridgemate-auth-fence-seeded__';

    if (window.sessionStorage.getItem(seedKey) === 'done') {
      return;
    }

    window.localStorage.clear();
    window.localStorage.setItem('fridgemate-auth-session', JSON.stringify(session));
    window.sessionStorage.setItem(seedKey, 'done');
  }, { token: 'test-token', user: DEFAULT_USER });

  let refreshRequestCount = 0;
  await page.route('**/api/auth/refresh', (route) => {
    refreshRequestCount += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: DEFAULT_USER })
    });
  });
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Temporary outage.' })
    })
  );

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: DEFAULT_USER.email })).toBeVisible();
  expect(refreshRequestCount).toBeGreaterThan(0);
  const refreshCountBeforeLogout = refreshRequestCount;

  await page.getByRole('banner').getByRole('button', { name: '로그아웃' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/로그아웃 상태를 다시 확인합니다/)).toBeVisible();
  await expect(
    page.evaluate(() => window.localStorage.getItem('fridgemate-auth-logout-pending:v1'))
  ).resolves.toBe('1');

  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/로그아웃 상태를 다시 확인합니다/)).toBeVisible();
  expect(refreshRequestCount).toBe(refreshCountBeforeLogout);
});

test('import review and local save still work when correction embedding budget is exhausted', async ({ page }) => {
  await seedBrowserState(page, {
    session: {
      token: 'test-token',
      user: DEFAULT_USER
    },
    ocrResult: {
      text: '두부 1모\n우유 1L'
    }
  });
  await mockApiSession(page, { user: DEFAULT_USER, restoreSession: true });
  let limitedRequestCount = 0;

  const returnRateLimit = (route) => {
    limitedRequestCount += 1;
    return route.fulfill({
      status: 429,
      headers: { 'Retry-After': '60' },
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Too many import analysis requests. Please try again later.' })
    });
  };

  await page.route('**/api/import/corrections/suggestions', returnRateLimit);
  await page.route('**/api/import/corrections', returnRateLimit);
  await gotoAndWait(page, '/import');

  await page.getByLabel('사진 고르기').setInputFiles({
    name: 'mock-receipt.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG
  });
  await page.getByRole('button', { name: '사진에서 재료 찾기' }).click();

  await expect(page.getByText('두부', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '선택 항목 저장' }).click();

  await expect(page).toHaveURL(/\/ingredients$/);
  await expect(page.getByRole('heading', { name: '두부' })).toBeVisible();
  expect(limitedRequestCount).toBeGreaterThanOrEqual(1);
});

test('authenticated API mode falls back to the user cache when the ingredient API returns a server error', async ({ page }) => {
  await seedBrowserState(page, {
    session: {
      token: 'test-token',
      user: DEFAULT_USER
    },
    scope: 'user:user-1',
    ingredients: [createIngredient('cached-1', { name: '김치', syncState: 'clean' })]
  });

  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DEFAULT_USER)
    })
  );
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: DEFAULT_USER })
    })
  );
  await page.route('**/api/ingredients', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Temporary outage.' })
    })
  );

  await gotoAndWait(page, '/ingredients');

  await expect(page.getByText('김치')).toBeVisible();
});
