import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScaledCookingPanel from '../ScaledCookingPanel';
import { makeQuantityLine, makeQuantityRecipe } from './fixtures/scaledCookingFixtures';
import { RecipeQuantitySessionProvider } from '../RecipeQuantitySession';
import { useRecipeQuantitySession } from '../../../hooks/useRecipeQuantitySession';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fillCore(pork = '201', onion = '80') {
  fireEvent.change(screen.getByRole('textbox', { name: /돼지고기 앞다리살 사용 가능량/ }), { target: { value: pork } });
  fireEvent.change(screen.getByRole('textbox', { name: /양파 사용 가능량/ }), { target: { value: onion } });
}

function confirm() {
  fireEvent.click(screen.getByRole('button', { name: '확인한 양으로 계산' }));
}

function result() {
  return screen.getByRole('region', { name: '분량 미리보기 결과' });
}

function openSeasonings() {
  fireEvent.click(screen.getByText('양념 사용량도 확인하기'));
}

function SharedPreview({ recipe }) {
  const session = useRecipeQuantitySession();
  const [open, setOpen] = useState(true);
  const confirmation = session.confirmations[recipe.id] ?? null;
  return <>
    <button onClick={() => setOpen(!open)}>화면 전환 테스트</button>
    <output data-testid="shared-record">{confirmation ? `${confirmation.targetServings}인 확인` : '미확인'}</output>
    {open ? <ScaledCookingPanel
      recipe={recipe}
      confirmation={confirmation}
      onConfirm={({ inventory, targetServings, amounts }) => session.confirm({
        recipeId: recipe.id, recipeVersion: recipe.version,
        inventoryRevision: session.context.inventoryRevision, targetServings, inventory, amounts,
      })}
      onInvalidate={() => session.invalidate(recipe.id)}
    /> : null}
  </>;
}

function renderShared() {
  const now = new Date();
  const mealDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  return render(<RecipeQuantitySessionProvider context={{ scope: 'guest', inventoryRevision: 'stock:1', mealDate, ready: true }}>
    <SharedPreview recipe={makeQuantityRecipe()} />
  </RecipeQuantitySessionProvider>);
}

describe('ScaledCookingPanel shared per-recipe confirmation', () => {
  it('publishes only an explicit confirmation and restores it across in-app navigation', () => {
    renderShared();
    fireEvent.change(screen.getByLabelText('요리 인원'), { target: { value: '2' } });
    fillCore();
    expect(screen.getByTestId('shared-record')).toHaveTextContent('미확인');
    confirm();
    expect(screen.getByTestId('shared-record')).toHaveTextContent('2인 확인');
    fireEvent.click(screen.getByText('화면 전환 테스트'));
    fireEvent.click(screen.getByText('화면 전환 테스트'));
    expect(screen.getByLabelText('요리 인원')).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: /돼지고기 앞다리살 사용 가능량/ })).toHaveValue('201');
    expect(within(result()).getByText('201g')).toBeVisible();
  });

  it('clears shared results immediately on edited quantities or servings', () => {
    renderShared(); fillCore(); confirm();
    expect(screen.getByTestId('shared-record')).toHaveTextContent('1인 확인');
    fillCore('100');
    expect(screen.getByTestId('shared-record')).toHaveTextContent('미확인');
    confirm();
    fireEvent.change(screen.getByLabelText('요리 인원'), { target: { value: '2' } });
    expect(screen.getByTestId('shared-record')).toHaveTextContent('미확인');
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
  });

  it('clears the shared result on blur but keeps editable input text', () => {
    renderShared(); fillCore(); confirm();
    expect(screen.getByTestId('shared-record')).toHaveTextContent('1인 확인');
    fireEvent(window, new Event('blur'));
    expect(screen.getByTestId('shared-record')).toHaveTextContent('미확인');
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /돼지고기 앞다리살 사용 가능량/ })).toHaveValue('201');
  });
});

describe('ScaledCookingPanel with real quantity calculation and synthetic source quantities', () => {
  it('does not expose a quantitative form for an unreviewed recipe', () => {
    const { container } = render(<ScaledCookingPanel recipe={{ id: 'legacy', servings: 1 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts with one person and blank quantities, with no automatically confirmed result', () => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    expect(screen.getByLabelText('요리 인원')).toHaveValue('1');
    expect(screen.getAllByRole('textbox').every((input) => input.value === '')).toBe(true);
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
    expect(screen.getByText(/빈칸은 미확인, 0은 없음/)).toBeVisible();
    expect(screen.getByText(/주간 재고를 자동 배분하지 않습니다/)).toBeVisible();
    expect(screen.getByText(/냉장고·장보기는 바뀌지 않습니다/)).toBeVisible();
  });

  it('shows independently calculated ingredient amounts only after confirmation', () => {
    const recipe = makeQuantityRecipe();
    const before = structuredClone(recipe);
    render(<ScaledCookingPanel recipe={recipe} />);
    fireEvent.change(screen.getByLabelText('요리 인원'), { target: { value: '2' } });
    fillCore();
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
    confirm();
    expect(within(result()).getByRole('heading', { name: '양을 줄여 만들 수 있어요' })).toBeVisible();
    expect(within(result()).getByText('201g')).toBeVisible();
    expect(within(result()).getByText('67g')).toBeVisible();
    expect(within(result()).getByText(/돼지고기 앞다리살.*양에 맞췄어요/)).toBeVisible();
    confirm();
    expect(within(result()).getByText('201g')).toBeVisible();
    expect(recipe).toEqual(before);
  });

  it('distinguishes the requested original portion from a scaled portion', () => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    fillCore();
    confirm();
    expect(within(result()).getByRole('heading', { name: '요청한 분량으로 만들 수 있어요' })).toBeVisible();
    expect(within(result()).getByText('150g')).toBeVisible();
    expect(within(result()).getByText('50g')).toBeVisible();
  });

  it('does not turn an empty field into available zero or a cooking claim', () => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    confirm();
    expect(within(result()).getByRole('heading', { name: '본재료 양을 확인해 주세요' })).toBeVisible();
    expect(within(result()).getAllByText('수량 미확인').length).toBeGreaterThan(0);
    expect(within(result()).queryByText('0g')).not.toBeInTheDocument();
  });

  it('distinguishes explicitly confirmed zero from an unknown quantity', () => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    fillCore('0');
    confirm();
    expect(within(result()).getByRole('heading', { name: '사용 가능한 본재료가 없어요' })).toBeVisible();
    expect(within(result()).queryByText('수량 미확인')).not.toBeInTheDocument();
  });

  it.each([
    ['0.4', '1g 미만'],
    ['2.6', '약 2g'],
  ])('formats a positive %sg suggestion without rounding up or showing zero', (amount, expected) => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    fillCore(amount);
    confirm();
    expect(within(result()).getAllByText(expected).length).toBeGreaterThan(0);
    expect(within(result()).queryByText('0g')).not.toBeInTheDocument();
    expect(within(result()).queryByText('3g')).not.toBeInTheDocument();
  });

  it('preserves a fractional count for a verified non-core ingredient', () => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'garlic', foodId: 'garlic', rawName: '마늘', role: 'seasoning', amount: 1, unit: '개' }));
    render(<ScaledCookingPanel recipe={recipe} />);
    fillCore();
    openSeasonings();
    fireEvent.change(screen.getByRole('textbox', { name: /마늘 사용 가능량/ }), { target: { value: '0.5' } });
    confirm();
    expect(within(result()).getByText('0.5개')).toBeVisible();
  });

  it.each([
    ['0', /간장.*부족/],
    ['', /간장.*확인 필요/],
  ])('keeps mandatory seasoning status separate when its input is %s', (amount, notice) => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'soy', foodId: 'soy', rawName: '간장', role: 'seasoning', amount: 10, unit: 'ml' }));
    render(<ScaledCookingPanel recipe={recipe} />);
    fillCore();
    openSeasonings();
    fireEvent.change(screen.getByRole('textbox', { name: /간장 사용 가능량/ }), { target: { value: amount } });
    confirm();
    expect(within(result()).getByRole('heading', { name: '요청한 분량으로 만들 수 있어요' })).toBeVisible();
    expect(within(result()).getByText(notice)).toBeVisible();
    expect(within(result()).queryByText('필수 재료의 양을 모두 확인했어요.')).not.toBeInTheDocument();
  });

  it('keeps a source-quantity-unknown seasoning as a check, not an invented numeric input', () => {
    const recipe = makeQuantityRecipe();
    recipe.ingredients.push(makeQuantityLine({ id: 'salt', foodId: 'salt', rawName: '소금', role: 'seasoning', amount: null, unit: null, quantityStatus: 'unknown', quantityEvidence: null }));
    render(<ScaledCookingPanel recipe={recipe} />);
    expect(screen.queryByRole('textbox', { name: /소금 사용 가능량/ })).not.toBeInTheDocument();
    fillCore();
    confirm();
    expect(within(result()).getByText(/소금.*확인 필요/)).toBeVisible();
    expect(within(result()).getByText('수량 미확인')).toBeVisible();
  });

  it('clears the result on amount or serving edits and requires confirmation again', () => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    fillCore();
    confirm();
    fillCore('100');
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
    confirm();
    expect(within(result()).getByText('100g')).toBeVisible();
    fireEvent.change(screen.getByLabelText('요리 인원'), { target: { value: '2' } });
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /돼지고기 앞다리살 사용 가능량/ })).toHaveValue('100');
  });

  it.each(['scope', 'contextKey', 'recipeVersion', 'recipeId'])('clears inputs and result when %s changes', (kind) => {
    const recipe = makeQuantityRecipe();
    const props = { recipe, scope: 'guest', contextKey: 'stock-v1' };
    const view = render(<ScaledCookingPanel {...props} />);
    fillCore();
    confirm();
    const nextProps = kind === 'scope' ? { ...props, scope: 'user:alice' }
      : kind === 'contextKey' ? { ...props, contextKey: 'stock-v2' }
        : { ...props, recipe: { ...recipe, [kind === 'recipeVersion' ? 'version' : 'id']: 'new-value' } };
    view.rerender(<ScaledCookingPanel {...nextProps} />);
    expect(screen.getAllByRole('textbox').every((input) => input.value === '')).toBe(true);
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
  });

  it('retains confirmed inputs for an equivalent same-context rerender', () => {
    const recipe = makeQuantityRecipe();
    const view = render(<ScaledCookingPanel recipe={recipe} contextKey="stock-v1" />);
    fillCore();
    confirm();
    view.rerender(<ScaledCookingPanel recipe={structuredClone(recipe)} contextKey="stock-v1" />);
    expect(screen.getByRole('textbox', { name: /돼지고기 앞다리살 사용 가능량/ })).toHaveValue('201');
    expect(within(result()).getByText('150g')).toBeVisible();
  });

  it.each(['blur', 'hidden'])('invalidates a confirmed preview on %s without erasing typed quantities', (event) => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    fillCore();
    confirm();
    if (event === 'blur') fireEvent(window, new Event('blur'));
    else {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
    }
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
    expect(screen.getByText(/화면을 벗어나.*다시 확인/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: /돼지고기 앞다리살 사용 가능량/ })).toHaveValue('201');
    confirm();
    expect(within(result()).getByText('150g')).toBeVisible();
  });

  it('removes its external-event listeners when the confirmed form unmounts', () => {
    const addWindow = vi.spyOn(window, 'addEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const addDocument = vi.spyOn(document, 'addEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const view = render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    fillCore();
    confirm();
    const blurHandler = addWindow.mock.calls.find(([event]) => event === 'blur')?.[1];
    const visibilityHandler = addDocument.mock.calls.find(([event]) => event === 'visibilitychange')?.[1];
    expect(blurHandler).toEqual(expect.any(Function));
    expect(visibilityHandler).toEqual(expect.any(Function));
    view.unmount();
    expect(removeWindow).toHaveBeenCalledWith('blur', blurHandler);
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', visibilityHandler);
  });

  it('shows an actionable field error instead of confirming a negative amount', () => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    fillCore('-1');
    confirm();
    expect(screen.getByRole('alert')).toHaveTextContent(/0 이상/);
    expect(screen.getByRole('textbox', { name: /돼지고기 앞다리살 사용 가능량/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('region', { name: '분량 미리보기 결과' })).not.toBeInTheDocument();
  });

  it('keeps review limitations visible and non-core inputs optional to expand', () => {
    const recipe = makeQuantityRecipe({
      reviewNote: '원문 대조만 완료했으며 사람의 조리 검수는 하지 않았습니다.',
      sourceNotes: ['구입 중량·손질 후 중량 구분은 원문 미표기. 손질 수율을 환산하지 않습니다.'],
    });
    recipe.ingredients.push(makeQuantityLine({ id: 'soy', foodId: 'soy', rawName: '간장', role: 'seasoning', amount: 10, unit: 'ml' }));
    render(<ScaledCookingPanel recipe={recipe} />);
    expect(screen.getByText(recipe.reviewNote)).toBeVisible();
    expect(screen.getByText(recipe.sourceNotes[0])).toBeVisible();
    expect(screen.getByRole('textbox', { name: /간장 사용 가능량/ })).not.toBeVisible();
    expect(screen.getByText(/입력하지 않은 양념은 미확인/)).toBeVisible();
    openSeasonings();
    expect(screen.getByRole('textbox', { name: /간장 사용 가능량/ })).toBeVisible();
  });

  it('does not display an underflow calculation as an actual zero-quantity dish', () => {
    render(<ScaledCookingPanel recipe={makeQuantityRecipe()} />);
    fillCore(`0.${'0'.repeat(323)}5`);
    confirm();
    expect(within(result()).getByRole('heading', { name: '계산할 수 없는 수량이에요' })).toBeVisible();
    expect(within(result()).queryByText('0g')).not.toBeInTheDocument();
  });
});
