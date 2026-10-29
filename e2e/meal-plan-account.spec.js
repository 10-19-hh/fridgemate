import { expect, test } from '@playwright/test';
import { DEFAULT_USER, gotoAndWait, mockApiSession, seedBrowserState } from './support/testApp';

test('guest and signed-in meal plans stay separate through login and logout', async ({ page }) => {
  await seedBrowserState(page);
  const api = await mockApiSession(page, { user: DEFAULT_USER });
  await gotoAndWait(page, '/meal-plan');
  await page.getByLabel('피하고 싶은 재료').fill('버섯');
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await expect(page.getByRole('article')).toHaveCount(7);
  await expect(page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' })).toBeEnabled();
  const guestTitles = await page.getByRole('article').getByRole('heading', { level: 3 }).allTextContents();
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: '로그인', exact: true }).click();
  await page.getByLabel('이메일').fill(DEFAULT_USER.email);
  await page.getByLabel('비밀번호').fill('password123');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('link', { name: '주간 식단' }).click();
  await expect(page.getByRole('button', { name: '한 주 식단 만들기' })).toBeEnabled();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('확정됨', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('피하고 싶은 재료')).toHaveValue('');
  await page.getByLabel('피하고 싶은 재료').fill('두부');
  await page.getByLabel('식사 인원').selectOption('2');
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  await expect(page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천' })).toBeEnabled();
  await expect(page.getByText('초안', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('피하고 싶은 재료')).toHaveValue('버섯');
  await expect(page.getByLabel('식사 인원')).toHaveValue('1');
  await expect(page.getByRole('article').getByRole('heading', { level: 3 })).toHaveText(guestTitles);
  await expect(page.getByText('확정됨', { exact: true })).toBeVisible();
  expect(api.ingredients).toEqual([]);
});

test('startup expiry clears old pilot records across accounts without deleting stock or active consent', async ({ page }) => {
  await seedBrowserState(page);
  await mockApiSession(page, { user: DEFAULT_USER });
  await gotoAndWait(page, '/meal-plan');
  const before = await page.evaluate(async () => {
    const db = await import('/src/db/indexedDB.js');
    const scopes = ['guest', 'user:pilot-expired', 'user:pilot-active'];
    const inventory = [];
    for (const scope of scopes) {
      const expired = scope !== 'user:pilot-active';
      const startedAt = expired ? '2020-01-01T00:00:00.000Z' : new Date(Date.now() - 86400000).toISOString();
      const expiresAt = new Date(Date.parse(startedAt) + 35 * 86400000).toISOString();
      const row = { id: 'session', schemaVersion: 1, scope, status: 'active', version: '1'.repeat(32),
        policyVersion: 'local-pilot-35d-v1', startedAt, expiresAt, subjectId: `sub_${'2'.repeat(32)}`,
        kind: scope === 'guest' ? 'guest' : 'account', observedThrough: startedAt,
        firstGenerationKnown: false, gaps: [], events: [] };
      await db.runMealPlanPilotTransaction('readwrite', store => store.put(row), scope);
      if (expired) await db.runMealPlanPilotTransaction('readwrite', store => store.put({ id: 'damaged-extra', private: 'delete with session' }), scope);
      await db.saveIngredient({ id: 'pilot-stock', name: '남겨야 할 두부', quantity: '반 모', expiryDate: null, consumed: false,
        updatedAt: '2026-09-21T09:00:00.000Z' }, scope);
      inventory.push(await db.getAllIngredients(scope));
    }
    return { inventory, active: await db.runMealPlanPilotTransaction('readonly', store => store.getAll(), scopes[2]) };
  });

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '이번 주 저녁, 미리 골라두세요' })).toBeVisible();
  const read = () => page.evaluate(async () => {
    const db = await import('/src/db/indexedDB.js');
    const scopes = ['guest', 'user:pilot-expired', 'user:pilot-active'];
    const pilot = await Promise.all(scopes.map(scope => db.runMealPlanPilotTransaction('readonly', store => store.getAll(), scope)));
    return { pilot, inventory: await Promise.all(scopes.map(scope => db.getAllIngredients(scope))) };
  });
  await expect.poll(async () => (await read()).pilot.map(rows => rows[0]?.status)).toEqual(['expired', 'expired', 'active']);
  const after = await read();
  expect(after.inventory).toEqual(before.inventory);
  expect(after.pilot[2]).toEqual(before.active);
  for (const rows of after.pilot.slice(0, 2)) {
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'schemaVersion', 'scope', 'status', 'version']);
    expect(rows[0].version).not.toBe('1'.repeat(32));
  }
});
