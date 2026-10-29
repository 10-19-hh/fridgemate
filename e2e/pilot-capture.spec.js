import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { validateLocalMealPlanPilotExport } from '../src/features/mealPlans/mealPlanPilotExport.js';
import { gotoAndWait, seedBrowserState } from './support/testApp';
import { GOOGLE_ANALYTICS_REQUEST_PATTERN } from './support/analyticsRequestPattern.js';

test.beforeEach(async ({ context, baseURL }) => {
  // These synthetic checks never contact external services or a real API.
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const remote = /^https?:$/.test(url.protocol) && url.origin !== origin;
    const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (remote || api) await route.abort();
    else await route.continue();
  });
});

async function pilotBrowserState(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('fridgemate-db__guest');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['mealPlanPilot', 'mealPlans'], 'readonly');
      const pilot = tx.objectStore('mealPlanPilot').get('session');
      const plans = tx.objectStore('mealPlans').getAll();
      tx.oncomplete = () => {
        const row = pilot.result;
        db.close();
        resolve({ status: row?.status, version: row?.version, subjectId: row?.subjectId,
          startedAt: row?.startedAt, expiresAt: row?.expiresAt, events: row?.events || [], gaps: row?.gaps || [],
          plans: plans.result.map(plan => ({ revision: plan.revision, hasDraft: Boolean(plan.draft),
            hasConfirmed: Boolean(plan.confirmed) })) });
      };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

async function startLocalPilot(page) {
  await gotoAndWait(page, '/pilot');
  await expect(page.getByRole('heading', { name: '식단 파일럿 참여', exact: true })).toBeVisible();
  const checkbox = page.getByRole('checkbox', { name: '이 기기에 식단 파일럿 기록을 저장하는 데 동의해요' });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await page.getByRole('button', { name: '동의하고 기록 시작' }).click();
  await expect(page.getByRole('button', { name: '파일럿 기록 내려받기' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '앞으로 기록 재개' })).toHaveCount(0);
}

test('local pilot records only opted-in outcomes and manually exports without enabling general analytics', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-28T08:00:00.000Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrowserState(page);
  let analyticsRequests = 0;
  await page.route(GOOGLE_ANALYTICS_REQUEST_PATTERN, async route => {
    analyticsRequests += 1;
    await route.abort();
  });
  await startLocalPilot(page);
  const initial = await pilotBrowserState(page);
  expect(initial.events).toEqual([]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^noindex(?:,|$)/);
  await page.getByRole('link', { name: '주간 식단', exact: true }).click();
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await expect(page.getByRole('button', { name: '이 식단 확정', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '이 식단 확정', exact: true }).click();
  await expect(page.getByText('식단을 확정했어요.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await pilotBrowserState(page)).events.map(event => event.name).sort()).toEqual([
    'meal_plan_confirmed', 'meal_plan_generated', 'meal_plan_generation_started',
  ]);
  await page.getByRole('link', { name: '식단 파일럿', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: '파일럿 기록 내려받기' }).click(),
  ]);
  const exported = validateLocalMealPlanPilotExport(JSON.parse(await readFile(await download.path(), 'utf8')));
  expect(exported.measurementUnit).toBe('browser-scope');
  expect(exported.dataset.subjects[0].firstGenerationKnown).toBe(false);
  expect(exported.dataset.events).toHaveLength(3);
  expect(JSON.stringify(exported)).not.toMatch(/aliasSecret|"scope"|week:|:dinner|requestKey|sourceToken|recipeId|ingredientId/);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-analytics-consent'))).toBe('denied');
  expect(analyticsRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('main').screenshot({ path: testInfo.outputPath('pilot-mobile-active.png') });
  const before = await pilotBrowserState(page);
  await page.getByRole('button', { name: '참여 철회 및 기록 삭제' }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  expect((await pilotBrowserState(page)).version).toBe(before.version);
  await page.getByRole('button', { name: '참여 철회 및 기록 삭제' }).click();
  await page.getByRole('button', { name: '철회 및 삭제 확인' }).click();
  await expect.poll(async () => (await pilotBrowserState(page)).status).toBe('withdrawn');
  const after = await pilotBrowserState(page);
  expect(after.events).toEqual([]);
  expect(after.subjectId).toBeUndefined();
  expect(after.plans).toEqual(before.plans);
});

test('local pilot write failure preserves a saved plan and requires explicit observation recovery', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-28T08:00:00.000Z'));
  await seedBrowserState(page);
  await startLocalPilot(page);
  await page.clock.setFixedTime(new Date('2026-09-28T08:00:01.000Z'));
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.__restorePilotWrites = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'mealPlanPilot') throw new DOMException('synthetic pilot quota', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('link', { name: '주간 식단', exact: true }).click();
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await expect(page.getByRole('button', { name: '이 식단 확정', exact: true })).toBeEnabled();
  const afterBusiness = await pilotBrowserState(page);
  expect(afterBusiness.plans).toEqual([{ revision: 1, hasDraft: true, hasConfirmed: false }]);
  expect(afterBusiness.events).toEqual([]);
  await expect(page.getByRole('link', { name: '파일럿 상태 확인' })).toBeVisible();
  await page.evaluate(() => window.__restorePilotWrites());
  await page.getByRole('link', { name: '파일럿 상태 확인' }).click();
  await expect(page.getByRole('button', { name: '앞으로 기록 재개' })).toBeEnabled();
  await page.clock.setFixedTime(new Date('2026-09-28T08:00:02.000Z'));
  await page.getByRole('button', { name: '앞으로 기록 재개' }).click();
  await expect(page.getByRole('button', { name: '앞으로 기록 재개' })).toHaveCount(0);
  const resumed = await pilotBrowserState(page);
  expect(resumed.events).toEqual([]);
  expect(resumed.gaps).toEqual([{ from: '2026-09-28T08:00:00.000Z', through: '2026-09-28T08:00:02.000Z', reason: 'missing' }]);
  expect(resumed.plans).toEqual(afterBusiness.plans);
  await page.locator('main').screenshot({ path: testInfo.outputPath('pilot-missing-observation.png') });
});

test('local pilot reload does not fabricate continuous observation or renew the consent period', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T08:00:00.000Z'));
  await seedBrowserState(page);
  await startLocalPilot(page);
  const initial = await pilotBrowserState(page);
  await page.clock.setFixedTime(new Date('2026-09-28T09:00:00.000Z'));
  await page.reload();
  await expect(page.getByRole('button', { name: '앞으로 기록 재개' })).toBeEnabled();
  const beforeResume = await pilotBrowserState(page);
  expect(beforeResume.events).toEqual([]);
  expect(beforeResume.expiresAt).toBe(initial.expiresAt);
  await page.getByRole('button', { name: '앞으로 기록 재개' }).click();
  await expect(page.getByRole('button', { name: '앞으로 기록 재개' })).toHaveCount(0);
  const resumed = await pilotBrowserState(page);
  expect(resumed.version).toBe(initial.version);
  expect(resumed.subjectId).toBe(initial.subjectId);
  expect(resumed.expiresAt).toBe(initial.expiresAt);
  expect(resumed.gaps).toEqual([{ from: '2026-09-28T08:00:00.000Z', through: '2026-09-28T09:00:00.000Z', reason: 'missing' }]);
  expect(resumed.events).toEqual([]);
});
