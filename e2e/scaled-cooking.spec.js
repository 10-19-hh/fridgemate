import { expect, test } from '@playwright/test';
import { createIngredient, gotoAndWait, readBrowserIngredients, seedBrowserState } from './support/testApp';

const recipePath = '/recipes/29-부추-콩가루-찜';

async function openPreview(page) {
  await seedBrowserState(page, { ingredients: [
    createIngredient('chives', { name: '조선부추', quantity: '50g', expiryDate: '2026-09-20' }),
    createIngredient('manual-shopping', { name: '우유', quantity: '2개', consumed: true, memo: '직접 쓴 장보기' }),
  ] });
  await gotoAndWait(page, recipePath);
  const panel = page.getByRole('region', { name: '이번 요리에 쓸 양으로 계산', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

test('preview preserves public recipe, nutrition, structured data, inventory and shopping through repeat and reload', async ({ page }, testInfo) => {
  const panel = await openPreview(page);
  const inventory = await readBrowserIngredients(page, 'guest');
  const sourceIngredients = await page.getByText(/\[1인분\]조선부추 50g/).textContent();
  const nutrition = await page.getByRole('heading', { name: '식약처 제공 영양성분' }).locator('..').locator('..').textContent();
  const structuredData = await page.locator('script[type="application/ld+json"]').allTextContents();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  await expect(panel.getByLabel('조선부추 사용 가능량 (g)')).toHaveValue('');
  await panel.getByLabel('조선부추 사용 가능량 (g)').fill('25');
  await panel.getByLabel('날콩가루 사용 가능량 (g)').fill('7');
  await panel.getByRole('button', { name: '확인한 양으로 계산' }).click();
  const result = panel.getByRole('region', { name: '분량 미리보기 결과' });
  await expect(result.getByText('25g', { exact: true })).toBeVisible();
  await expect(result.getByText('약 3g', { exact: true })).toBeVisible();
  await expect(result.getByText('3.5g', { exact: true })).toHaveCount(0);
  await expect(result.getByText('참깨: 확인 필요', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '확인한 양으로 계산' }).click();
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventory);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  expect(await page.getByText(/\[1인분\]조선부추 50g/).textContent()).toBe(sourceIngredients);
  expect(await page.getByRole('heading', { name: '식약처 제공 영양성분' }).locator('..').locator('..').textContent()).toBe(nutrition);
  expect(await page.locator('script[type="application/ld+json"]').allTextContents()).toEqual(structuredData);
  await panel.screenshot({ path: testInfo.outputPath('scaled-preview-desktop.png') });
  await page.reload();
  await expect(panel.getByLabel('조선부추 사용 가능량 (g)')).toHaveValue('');
  await expect(result).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventory);
});

test('mobile quantity entry keeps zero distinct from small positive values and invalidates edited or unfocused previews', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openPreview(page);
  const calculate = panel.getByRole('button', { name: '확인한 양으로 계산' });
  await panel.getByLabel('조선부추 사용 가능량 (g)').fill('0');
  await panel.getByLabel('날콩가루 사용 가능량 (g)').fill('7');
  await calculate.click();
  const result = panel.getByRole('region', { name: '분량 미리보기 결과' });
  await expect(result).toBeVisible();
  await expect(result.getByRole('heading', { name: '사용 가능한 본재료가 없어요' })).toBeVisible();
  await panel.getByLabel('조선부추 사용 가능량 (g)').fill('0.4');
  await expect(result).toHaveCount(0);
  await calculate.focus();
  await page.keyboard.press('Enter');
  await expect(result.getByText('1g 미만', { exact: true }).first()).toBeVisible();
  await expect(result.getByText('0g', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await calculate.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await panel.screenshot({ path: testInfo.outputPath('scaled-preview-mobile.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(result).toHaveCount(0);
  await expect(panel.getByLabel('조선부추 사용 가능량 (g)')).toHaveValue('0.4');
});

test('confirmed small portions reach the actual recommendation card and reset when confirmation is lost', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openPreview(page);
  const inventory = await readBrowserIngredients(page, 'guest');
  await panel.getByLabel('조선부추 사용 가능량 (g)').fill('0.4');
  await panel.getByLabel('날콩가루 사용 가능량 (g)').fill('7');
  await panel.getByRole('button', { name: '확인한 양으로 계산' }).click();
  await page.getByRole('link', { name: '추천 목록에서 보기' }).click();
  const counts = page.getByRole('region', { name: '분량 확인 상태' });
  await expect(counts.getByText('필수 재료량 확인 0개', { exact: true })).toBeVisible();
  await expect(counts.getByText('추가 확인 필요 1개', { exact: true })).toBeVisible();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '부추 콩가루 찜', exact: true }) });
  const result = card.getByRole('region', { name: '확인한 분량' });
  await expect(result.getByText('본재료 축소 가능', { exact: true })).toBeVisible();
  await expect(result.getByText('1g 미만', { exact: true })).toHaveCount(2);
  await expect(result.getByText('참깨: 확인 필요', { exact: true })).toBeVisible();
  await expect(card.getByText('재료 종류 일치', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath('scaled-recommendation-mobile.png') });
  const selectRecipe = card.getByRole('button', { name: '부추 콩가루 찜', exact: true });
  await selectRecipe.evaluate((button) => button.addEventListener('click', () => {
    button.dataset.keyboardClicks = String(Number(button.dataset.keyboardClicks || 0) + 1);
  }));
  await selectRecipe.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(selectRecipe).toHaveAttribute('data-keyboard-clicks', '2');
  const detail = card.getByRole('link', { name: '분량 확인하기' });
  await detail.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('조선부추 사용 가능량 (g)')).toHaveValue('0.4');
  await expect(page.getByRole('region', { name: '분량 미리보기 결과' })).toBeVisible();
  await page.getByRole('link', { name: '추천 목록에서 보기' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(result.getByText('수량 확인 필요', { exact: true })).toBeVisible();
  await expect(result.getByText('1g 미만', { exact: true })).toHaveCount(0);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(inventory);
});

test('all three source-reviewed recipes are discoverable and keep individual confirmation inputs', async ({ page }) => {
  await seedBrowserState(page, { ingredients: [] });
  await gotoAndWait(page, '/recipes');
  const sources = page.getByRole('region', { name: '보유량으로 분량 맞추기' });
  await expect(sources.getByRole('link')).toHaveCount(3);
  await sources.getByRole('link', { name: '방울토마토 소박이' }).click();
  await expect(page.getByLabel('방울토마토 사용 가능량 (g)')).toHaveValue('');
  await page.getByLabel('방울토마토 사용 가능량 (g)').fill('75');
  await page.getByLabel('양파 사용 가능량 (g)').fill('10');
  await page.getByLabel('부추 사용 가능량 (g)').fill('10');
  await page.getByRole('button', { name: '확인한 양으로 계산' }).click();
  await expect(page.getByRole('region', { name: '분량 미리보기 결과' }).getByText('75g', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '추천 목록에서 보기' }).click();
  await sources.getByRole('link', { name: /치커리/ }).click();
  await expect(page.getByLabel('양파 사용 가능량 (g)')).toHaveValue('');
  await expect(page.getByRole('region', { name: '분량 미리보기 결과' })).toHaveCount(0);
});
