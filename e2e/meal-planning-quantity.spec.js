import { expect, test } from '@playwright/test';
import { createIngredient, gotoAndWait, readBrowserIngredients, seedBrowserState } from './support/testApp';

test('weekly quantity approval keeps the dinner, shares future stock and preserves manual shopping after reload', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-16T00:00:00Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrowserState(page, { ingredients: [
    createIngredient('tomato', { name: '방울토마토', quantity: '반 팩', expiryDate: '2026-09-30' }),
    createIngredient('onion', { name: '양파', quantity: '일부', expiryDate: '2026-09-30' }),
    createIngredient('chives', { name: '부추', quantity: '일부', expiryDate: '2026-09-30' }),
    createIngredient('manual', { name: '우유', consumed: true, memo: '직접 쓴 장보기' }),
  ] });
  await gotoAndWait(page, '/meal-plan');
  await page.getByLabel('주 시작일').fill('2026-09-14');
  await page.getByRole('button', { name: '한 주 식단 만들기' }).click();
  const wednesday = page.getByRole('article', { name: '2026-09-16 저녁 식단' });
  await expect(wednesday).toBeVisible();
  const dinner = await wednesday.getByRole('heading').textContent();
  const stock = await readBrowserIngredients(page, 'guest');
  await page.getByRole('button', { name: '정량 반찬 계획 펼치기' }).click();
  const panel = page.getByRole('region', { name: '정량 반찬 계획', exact: true });
  await panel.getByText('계산에 사용할 냉장고 재고 확인', { exact: true }).click();
  for (const [name, value, amount] of [['방울토마토', 'cherry-tomato|raw|g', '225'], ['양파', 'onion|raw|g', '30'], ['부추', 'chives|raw|g', '30']]) {
    const row = panel.getByRole('group', { name: `냉장고 ${name}`, exact: true });
    await row.getByRole('combobox', { name: '계산할 재료', exact: true }).selectOption(value);
    await row.getByLabel('확인한 보유량', { exact: true }).fill(amount);
    await row.getByLabel('쓸 수 있는 상태임을 확인').check();
    expect((await row.getByLabel('쓸 수 있는 상태임을 확인').boundingBox()).width).toBeLessThanOrEqual(24);
  }
  await panel.getByRole('button', { name: '재고 확인값 저장' }).click();
  await expect(panel.getByText('재고 확인값을 저장했어요. 실제 냉장고 수량은 바꾸지 않았어요.')).toBeVisible();
  await panel.getByRole('combobox', { name: '계획할 날짜', exact: true }).selectOption('2026-09-16:dinner');
  await panel.getByRole('combobox', { name: '추가할 반찬', exact: true }).selectOption('mfds:31');
  await panel.getByRole('button', { name: '분량 미리보기' }).click();
  await expect(panel.getByRole('region', { name: '승인 전 분량' }).getByText('150g', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '이 분량을 식단에 승인' }).click();
  await expect(panel.getByText('반찬 예정량을 저장하고 정량 반찬 장보기를 갱신했어요.')).toBeVisible();
  await panel.getByRole('combobox', { name: '계획할 날짜', exact: true }).selectOption('2026-09-17:dinner');
  await panel.getByRole('button', { name: '분량 미리보기' }).click();
  const preview = panel.getByRole('region', { name: '승인 전 분량' });
  await expect(preview.getByText('75g', { exact: true })).toBeVisible();
  await expect(preview.getByText('5g', { exact: true })).toHaveCount(2);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(stock);
  await panel.getByRole('button', { name: '이 분량을 식단에 승인' }).click();
  await expect(panel.getByRole('region', { name: '승인한 정량 반찬' }).getByText('방울토마토 소박이')).toHaveCount(2);
  await expect(wednesday.getByRole('heading')).toHaveText(dinner);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(stock);
  await page.reload();
  await page.getByRole('button', { name: '정량 반찬 계획 펼치기' }).click();
  await expect(panel.getByRole('region', { name: '승인한 정량 반찬' }).getByText('방울토마토 소박이')).toHaveCount(2);
  // Unknown source quantities stay separate per meal instead of becoming an invented sum.
  await expect(panel.getByRole('region', { name: '정량 반찬 장보기' }).getByText('통깨', { exact: true })).toHaveCount(2);
  expect(await readBrowserIngredients(page, 'guest')).toEqual(stock);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await panel.getByRole('radio', { name: '보유량에 맞춘 분량 제안' }).boundingBox()).width).toBeLessThanOrEqual(24);
  await panel.screenshot({ path: testInfo.outputPath('weekly-quantity-mobile.png') });
});
