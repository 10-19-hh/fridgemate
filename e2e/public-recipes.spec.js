import { expect, test } from '@playwright/test';
import { createIngredient, gotoAndWait, readBrowserIngredients, seedBrowserState } from './support/testApp';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];

function explorer(page) {
  return page.getByRole('region', { name: '남은 재료로 무엇을 만들까요?' });
}

function checklist(page) {
  return page.getByRole('region', { name: '있는 재료를 체크하고 준비할 것을 확인하세요' });
}

async function expectGuestStorage(page, expectedIngredients = []) {
  expect(await readBrowserIngredients(page, 'guest')).toEqual(expectedIngredients);
  expect(await page.evaluate(() => localStorage.getItem('fridgemate-auth-session'))).toBeNull();
}

async function expectNoHorizontalOverflow(page) {
  const { contentWidth, viewportWidth } = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }));
  expect(contentWidth).toBeLessThanOrEqual(viewportWidth + 1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`public recipes on ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // These journeys verify the application's real catalog and navigation.
      // A third-party image server must not delay the page load under test.
      await page.route('https://www.foodsafetykorea.go.kr/uploadimg/**', (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=', 'base64')
      }));
    });

    test('a fresh visitor finds a recipe, confirms ingredients and reads all cooking steps without saving', async ({ page }) => {
      await seedBrowserState(page);
      await gotoAndWait(page, '/');
      await expect(explorer(page)).toBeVisible();
      await expect(explorer(page).getByRole('link', { name: /^새우 두부 계란찜/u })).toBeVisible();
      await expectGuestStorage(page);

      await explorer(page).getByRole('textbox', { name: '다른 재료도 찾아보기' }).fill('오이, 사과');
      await explorer(page).getByRole('button', { name: '재료로 찾기' }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('have')).toBe('오이,사과');
      const recipeLink = explorer(page).getByRole('link', { name: /^순두부 사과 소스 오이무침/u });
      await expect(recipeLink).toBeVisible();
      await recipeLink.click();

      await expect(page.getByRole('heading', { level: 1, name: '순두부 사과 소스 오이무침' })).toBeVisible();
      expect(decodeURIComponent(new URL(page.url()).pathname)).toBe('/recipes/32-순두부-사과-소스-오이무침');
      expect(new URL(page.url()).searchParams.get('have')).toBe('오이,사과');
      await expect(checklist(page).getByRole('checkbox', { name: '오이 70g' })).toBeChecked();
      await expect(checklist(page).getByRole('checkbox', { name: '사과 50g' })).toBeChecked();
      await expect(checklist(page).getByRole('checkbox', { name: '순두부 40g' })).not.toBeChecked();
      await expect(checklist(page).getByRole('heading', { name: '추가 확인·준비 목록 3개' })).toBeVisible();

      await checklist(page).getByRole('checkbox', { name: '순두부 40g' }).check();
      await expect(checklist(page).getByRole('heading', { name: '추가 확인·준비 목록 2개' })).toBeVisible();
      const steps = page.locator('section').filter({ has: page.getByRole('heading', { name: '3단계 조리 순서' }) });
      await expect(steps.getByRole('listitem')).toHaveCount(3);
      await expect(steps.getByText(/사과, 순두부를 믹서에 넣고/u)).toBeVisible();
      await expectGuestStorage(page);
      await expectNoHorizontalOverflow(page);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(checklist(page).getByRole('checkbox', { name: '순두부 40g' })).not.toBeChecked();
      await expect(checklist(page).getByRole('checkbox', { name: '오이 70g' })).toBeChecked();
      await expectGuestStorage(page);
    });

    test('a guide example reaches its selected recipe and preserves guest inventory', async ({ page }) => {
      await seedBrowserState(page);
      await gotoAndWait(page, '/');
      await explorer(page).getByRole('link', { name: '예시 냉장고로 메뉴 고르기' }).click();
      await expect(page).toHaveURL(/\/guides\/fridge-cleanout$/u);
      const example = page.getByRole('region', { name: '순두부·오이·사과로 무침을 고르는 예시' });
      await expect(example.getByRole('heading', { name: '선택한 메뉴의 추가 준비 목록' })).toBeVisible();
      await expect(example.getByRole('listitem').filter({ hasText: /^다진 땅콩 10g$/u })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await example.getByRole('link', { name: '예시 재료로 선택한 조리법 보기' }).click();

      await expect(page.getByRole('heading', { level: 1, name: '순두부 사과 소스 오이무침' })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('have')).toBe('순두부,오이,사과,소금');
      await expect(checklist(page).getByRole('heading', { name: '추가 확인·준비 목록 1개' })).toBeVisible();
      await expect(checklist(page).getByRole('checkbox', { name: '다진 땅콩 10g' })).not.toBeChecked();
      await expect(checklist(page).getByRole('checkbox', { name: '순두부 40g' })).toBeChecked();
      await expect(page.getByRole('heading', { name: '3단계 조리 순서' })).toBeVisible();
      await expectGuestStorage(page);
      await expectNoHorizontalOverflow(page);
    });

    test('a guest picks one relevant menu and opens its exact preparation page', async ({ page }) => {
      // Keep the chosen catalog recipe deterministic; component tests cover the full pool and rerolls.
      await page.addInitScript(() => { Math.random = () => 0; });
      await seedBrowserState(page);
      await gotoAndWait(page, '/recipes?have=오이,사과');
      const picker = explorer(page).getByRole('region', { name: '메뉴 하나 골라보기' });
      await picker.getByRole('button', { name: '메뉴 하나 골라보기', exact: true }).focus();
      await page.keyboard.press('Enter');
      const detail = picker.getByRole('link', { name: '골라본 메뉴의 재료와 조리법 보기' });
      await expect(detail).toBeVisible();
      const destination = new URL(await detail.getAttribute('href'), page.url());
      expect(destination.searchParams.get('have')).toBe('오이,사과');
      expect(decodeURIComponent(destination.pathname)).toBe('/recipes/32-순두부-사과-소스-오이무침');
      expect(new URL(page.url()).pathname).toBe('/recipes');
      await expectGuestStorage(page);
      await expectNoHorizontalOverflow(page);

      await detail.click();
      await expect(checklist(page).getByRole('checkbox', { name: '오이 70g' })).toBeChecked();
      await expect(checklist(page).getByRole('checkbox', { name: '사과 50g' })).toBeChecked();
      await expect(checklist(page).getByRole('checkbox', { name: '순두부 40g' })).not.toBeChecked();
      await expect(page.getByRole('heading', { level: 1, name: '순두부 사과 소스 오이무침' })).toBeVisible();
      await expectGuestStorage(page);
    });

    test('a returning guest sees saved priorities and can still browse public recipes', async ({ page }) => {
      await seedBrowserState(page, {
        ingredients: [
          createIngredient('tofu-priority', { name: '순두부', quantity: '100g', expiryDate: '2026-09-07' }),
          createIngredient('cucumber-later', { name: '오이', quantity: '100g', expiryDate: '2026-09-10' })
        ]
      });
      await gotoAndWait(page, '/');
      await expect(page.getByRole('heading', { level: 1, name: '먼저 쓸 재료와 오늘 메뉴를 확인하세요' })).toBeVisible();
      const priorities = page.locator('section').filter({ has: page.getByRole('heading', { name: '유통기한 임박 리스트' }) });
      await expect(priorities.getByText('순두부', { exact: true })).toBeVisible();
      await expect(priorities.getByText('오이', { exact: true })).toBeVisible();
      const before = await readBrowserIngredients(page, 'guest');
      expect(before.map((item) => item.name).sort()).toEqual(['순두부', '오이']);
      const priorityBeforeExplorer = await priorities.evaluate((node) =>
        Boolean(node.compareDocumentPosition(document.querySelector('[aria-labelledby="public-explorer-title"]')) & Node.DOCUMENT_POSITION_FOLLOWING));
      expect(priorityBeforeExplorer).toBe(true);

      await expect(explorer(page)).toBeVisible();
      await explorer(page).getByRole('button', { name: '두부', exact: true }).click();
      await explorer(page).getByRole('link', { name: /^순두부 사과 소스 오이무침/u }).click();
      await expect(page.getByRole('heading', { level: 1, name: '순두부 사과 소스 오이무침' })).toBeVisible();
      // The broad "두부" exploration filter must not claim exact source ownership.
      await expect(checklist(page).getByRole('checkbox', { name: '순두부 40g' })).not.toBeChecked();
      await expect(checklist(page).getByRole('checkbox', { name: '오이 70g' })).not.toBeChecked();
      await checklist(page).getByRole('checkbox', { name: '내 냉장고와 보유 양념도 반영하기' }).check();
      await expect(checklist(page).getByRole('checkbox', { name: '순두부 40g' })).toBeChecked();
      await expect(checklist(page).getByRole('checkbox', { name: '오이 70g' })).toBeChecked();
      await expectGuestStorage(page, before);
      await expectNoHorizontalOverflow(page);
    });
  });
}

test('ACQ-02 keeps displayed guest inventory and meal preferences out of public metadata and HTML', async ({ page }) => {
  const ingredient = createIngredient('acq02-private-inventory', {
    name: 'ACQ02_PRIVATE_INGREDIENT', quantity: '7319g', memo: 'ACQ02_PRIVATE_MEMO',
    purchaseDate: '2031-04-17', expiryDate: '2031-05-23'
  });
  const excluded = 'ACQ02_PRIVATE_EXCLUSION';
  const privateValues = [ingredient.id, ingredient.name, ingredient.quantity, ingredient.memo,
    ingredient.purchaseDate, ingredient.expiryDate, excluded];
  const origin = 'https://xn--wh1bs8l5xa003adme.com';
  const recipePath = '/recipes/32-순두부-사과-소스-오이무침';
  await page.clock.setFixedTime(new Date('2026-10-12T08:00:00.000Z'));
  await page.route('https://www.foodsafetykorea.go.kr/uploadimg/**', route => route.fulfill({
    status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=', 'base64')
  }));
  await seedBrowserState(page, { ingredients: [ingredient] });

  // Positive controls: these values must really be loaded, not merely seeded
  // into an unused store, before their absence from public output can pass.
  await gotoAndWait(page, `/ingredients/${ingredient.id}/edit`);
  await expect(page.getByLabel('이름 *', { exact: true })).toHaveValue(ingredient.name);
  await expect(page.getByLabel('수량 *', { exact: true })).toHaveValue(ingredient.quantity);
  await expect(page.getByRole('textbox', { name: '메모 (선택)', exact: true })).toHaveValue(ingredient.memo);
  await expect(page.getByLabel('구매일', { exact: true })).toHaveValue(ingredient.purchaseDate);
  await expect(page.getByLabel('유통기한', { exact: true })).toHaveValue(ingredient.expiryDate);

  async function expectPrivateHead() {
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /^noindex(?:,|$)/);
    await expect(page.locator('head script[type="application/ld+json"]')).toHaveCount(0);
  }
  await expectPrivateHead();

  // Persist the preference fixture through the real guest form and repository;
  // no hand-written meal-plan record or development-only module import is used.
  await page.getByRole('link', { name: '주간 식단', exact: true }).click();
  await expect(page.getByRole('button', { name: '한 주 식단 만들기', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: '식사 인원', exact: true }).selectOption('2');
  await page.getByRole('textbox', { name: '피하고 싶은 재료', exact: true }).fill(excluded);
  for (const day of ['화', '수', '목', '금', '토', '일']) {
    await page.getByLabel(`${day}요일 저녁`, { exact: true }).uncheck();
  }
  await page.getByRole('button', { name: '한 주 식단 만들기', exact: true }).click();
  await expect(page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천', exact: true })).toBeEnabled();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '고정하지 않은 메뉴 다시 추천', exact: true })).toBeEnabled();
  const settings = page.locator('.meal-plan-settings details');
  if (!(await settings.evaluate(element => element.open))) await settings.locator('summary').click();
  await expect(page.getByRole('textbox', { name: '피하고 싶은 재료', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '피하고 싶은 재료', exact: true })).toHaveValue(excluded);
  await expect(page.getByRole('combobox', { name: '식사 인원', exact: true })).toHaveValue('2');
  await expect(page.getByLabel('월요일 저녁', { exact: true })).toBeChecked();
  await expect(page.getByLabel('화요일 저녁', { exact: true })).not.toBeChecked();

  const homeResponse = await page.request.get('/');
  expect(homeResponse.status()).toBe(200);
  const homeSource = await homeResponse.text();
  const developmentServer = homeSource.includes('/@vite/client');

  async function expectPublicOutput(path, schemaType, generatedPath) {
    const canonical = new URL(path, origin).href;
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
    await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute('content', canonical);
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', canonical);
    await expect.poll(() => page.locator('head script[type="application/ld+json"]').evaluateAll(nodes =>
      nodes.map(node => JSON.parse(node.textContent)['@type']))).toContain(schemaType);
    const title = await page.title();
    expect(title).toContain('오늘뭐먹지');
    await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute('content', title);
    const description = await page.locator('head meta[name="description"]').getAttribute('content');
    expect(description?.trim()).toBeTruthy();
    await expect(page.locator('head meta[property="og:description"]')).toHaveAttribute('content', description);
    const head = await page.locator('head').innerHTML();

    // Vite preview does not implement hosting rewrites. Inspect the generated
    // public document explicitly there; development serves its real empty shell.
    // Neither path is page.content(), which includes private hydrated UI.
    const response = await page.request.get(encodeURI(developmentServer ? path : generatedPath));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const source = await response.text();
    expect(source).toContain('<title>');
    expect(source).toContain('오늘뭐먹지');
    if (developmentServer) {
      expect(source).toContain('/@vite/client');
      expect(source).toContain('<div id="root"></div>');
    } else {
      expect(source).toContain(`href="${canonical}"`);
      expect(source).toContain(`<title>${title}</title>`);
      expect(source).toContain('<!--seo-prerender-start-->');
      expect(source).toMatch(/<h1(?:\s|>)/);
      expect(source).toContain(`"@type":"${schemaType}"`);
    }
    for (const value of privateValues) {
      expect(head).not.toContain(value);
      expect(source).not.toContain(value);
    }
  }

  await page.getByRole('link', { name: '홈', exact: true }).click();
  await expect(page.getByText(ingredient.name, { exact: true })).toBeVisible();
  await expectPublicOutput('/', 'WebSite', '/');
  // The same SPA must remove public schema on a private route and restore the
  // correct public schema afterward, without incorporating the loaded settings.
  await page.getByRole('link', { name: '주간 식단', exact: true }).click();
  await expect(page.getByRole('heading', { name: '이번 주 저녁, 미리 골라두세요' })).toBeVisible();
  await expectPrivateHead();
  await page.getByRole('link', { name: '서비스 소개', exact: true }).click();
  await expectPublicOutput('/about', 'AboutPage', '/_seo/about.html');
  await gotoAndWait(page, recipePath);
  await expect(page.getByRole('heading', { level: 1, name: '순두부 사과 소스 오이무침' })).toBeVisible();
  await expectPublicOutput(recipePath, 'Recipe', `/_seo${recipePath}.html`);
  await expectGuestStorage(page, [ingredient]);
});
