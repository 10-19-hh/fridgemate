import { expect, test } from '@playwright/test';
import { createIngredient, DEFAULT_USER, gotoAndWait, mockApiSession, readBrowserIngredients, seedBrowserState } from './support/testApp';

test('a quantity preview is cleared on logout without copying personal values into guest storage', async ({ page }) => {
  await seedBrowserState(page, {
    session: { token: 'test-token', user: DEFAULT_USER }, scope: 'user:user-1',
    ingredients: [createIngredient('private-chives', { name: '조선부추', quantity: '123.456g', expiryDate: '2026-09-20' })],
  });
  const api = await mockApiSession(page, { user: DEFAULT_USER, restoreSession: true });
  await gotoAndWait(page, '/recipes/29-부추-콩가루-찜');
  const panel = page.getByRole('region', { name: '이번 요리에 쓸 양으로 계산', exact: true });
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  const before = await readBrowserIngredients(page, 'user:user-1');
  await expect(panel.getByLabel('조선부추 사용 가능량 (g)')).toHaveValue('');
  await panel.getByLabel('조선부추 사용 가능량 (g)').fill('12.345');
  await panel.getByLabel('날콩가루 사용 가능량 (g)').fill('7');
  await panel.getByRole('button', { name: '확인한 양으로 계산' }).click();
  await expect(panel.getByRole('region', { name: '분량 미리보기 결과' })).toBeVisible();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(panel.getByLabel('조선부추 사용 가능량 (g)')).toHaveValue('');
  await expect(panel.getByRole('region', { name: '분량 미리보기 결과' })).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'user:user-1')).toEqual(before);
  expect(await readBrowserIngredients(page, 'guest')).toEqual([]);
  expect(api.ingredients).toEqual([]);
  const publicData = (await page.locator('script[type="application/ld+json"]').allTextContents()).join('');
  expect(publicData).not.toContain('12.345');
  expect(publicData).not.toContain('private-chives');
});
