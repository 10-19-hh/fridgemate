import { expect, test } from '@playwright/test';
import { createIngredient, gotoAndWait, seedBrowserState } from './support/testApp';

test('keyboard users can skip repeated navigation and continue in the main content', async ({ page }) => {
  await seedBrowserState(page);
  await gotoAndWait(page, '/');
  await expect(page.getByRole('main').getByRole('link', { name: '이번 주 식단 만들기', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '본문 바로가기', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.getByRole('main').evaluate(main => main.contains(document.activeElement))).toBe(true);
});

test('the current navigation item agrees with the add and edit ingredient routes', async ({ page }) => {
  await seedBrowserState(page);
  await gotoAndWait(page, '/ingredients/new');
  await expect(page.locator('nav [aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('nav [aria-current="page"]')).toHaveAccessibleName('추가');
  await gotoAndWait(page, '/ingredients/missing/edit');
  await expect(page.locator('nav [aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('nav [aria-current="page"]')).toHaveAccessibleName('냉장고');
});

test('opening analytics settings moves focus inside and a saved choice returns to its trigger', async ({ page }) => {
  await seedBrowserState(page);
  await gotoAndWait(page, '/');
  const trigger = page.getByRole('button', { name: '분석 설정', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: '필수 기능만', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-analytics-consent'))).toBe('denied');
});

test('a keyboard can reach the OCR photo picker and open the native chooser on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrowserState(page);
  await gotoAndWait(page, '/import');
  const input = page.getByLabel('사진 고르기');
  for (let index = 0; index < 35; index += 1) {
    await page.keyboard.press('Tab');
    if (await input.evaluate(node => node === document.activeElement)) break;
  }
  await expect(input).toBeFocused();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
  expect(chooser.isMultiple()).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ocr-picker-keyboard-mobile.png'), fullPage: true });
});

test('small active navigation text has at least 4.5 to 1 contrast', async ({ page }) => {
  await seedBrowserState(page);
  await gotoAndWait(page, '/');
  const ratio = await page.locator('nav [aria-current="page"]').evaluate(node => {
    const css = getComputedStyle(node);
    const luminance = color => {
      const [red, green, blue] = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const foreground = luminance(css.color);
    const background = luminance(css.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('an undecided consent banner does not cover the focused mobile first-plan action', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBrowserState(page, { analyticsConsent: null });
  await gotoAndWait(page, '/');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const action = page.getByRole('main').getByRole('link', { name: '이번 주 식단 만들기', exact: true });
  await action.focus();
  const uncovered = await action.evaluate(node => {
    const r = node.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === node || node.contains(top);
  });
  await page.screenshot({ path: testInfo.outputPath('consent-focused-action-mobile.png') });
  expect(uncovered).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-analytics-consent'))).toBeNull();
});

test('tabbing through mobile content keeps focused controls uncovered before consent', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBrowserState(page, { analyticsConsent: null });
  await gotoAndWait(page, '/');
  await expect(page.getByRole('main').getByRole('link', { name: '이번 주 식단 만들기', exact: true })).toBeVisible();
  const covered = [];
  for (let index = 0; index < 45; index += 1) {
    await page.keyboard.press('Tab');
    const issue = await page.evaluate(() => {
      const node = document.activeElement;
      if (!node.closest('main')) return null;
      const r = node.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top === node || node.contains(top)) return null;
      return { name: node.textContent.trim(), covering: top?.closest('[role="dialog"]') ? 'consent' : top?.tagName || 'outside viewport' };
    });
    if (issue) {
      if (!covered.length) await page.screenshot({ path: testInfo.outputPath('covered-keyboard-control-mobile.png') });
      covered.push(issue);
    }
  }
  expect(covered).toEqual([]);
});

test('reduced-motion preference disables document smooth scrolling outside the meal-plan page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBrowserState(page);
  await gotoAndWait(page, '/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});

test('saving an inventory quantity by keyboard preserves a usable position after the form resets', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T08:00:00.000Z'));
  await seedBrowserState(page, { ingredients: [createIngredient('keyboard-tofu', { name: '두부', quantity: '300g',
    purchaseDate: '2026-09-28', expiryDate: '2026-10-02' })] });
  await gotoAndWait(page, '/ingredients');
  const panel = page.getByRole('region', { name: '남은 수량 확인', exact: true });
  await panel.getByRole('button', { name: '수량 확인 목록 열기', exact: true }).click();
  const form = panel.getByRole('form', { name: '두부 남은 수량 확인', exact: true });
  await form.getByLabel('확인한 남은 양', { exact: true }).fill('300');
  await form.getByLabel('단위', { exact: true }).selectOption('g');
  await form.getByLabel('조리 상태', { exact: true }).selectOption('raw');
  await form.getByRole('button', { name: '확인한 수량 저장', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(form.getByText('사용자 확인됨', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '남은 수량 확인', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: '수량 목록 새로고침', exact: true })).toBeFocused();
});

test('saving a shopping note by keyboard restores focus without losing the saved note', async ({ page }) => {
  await seedBrowserState(page);
  await gotoAndWait(page, '/ingredients');
  const panel = page.getByRole('region', { name: '장보기 메모', exact: true });
  await panel.getByRole('button', { name: '장보기 메모 열기', exact: true }).click();
  const form = panel.getByRole('form', { name: '수동 장보기 추가', exact: true });
  await form.getByLabel('품목 이름', { exact: true }).fill('우유');
  await form.getByRole('button', { name: '수동 항목 추가', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('form', { name: '우유 수동 항목', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '장보기 메모', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: '장보기 메모 새로고침', exact: true })).toBeFocused();
});
