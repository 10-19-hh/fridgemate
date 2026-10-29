import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryQuantityReview from '../InventoryQuantityReview';
import IngredientsPage from '../../pages/IngredientsPage';
import * as authHook from '../../hooks/useAuth';
import * as ingredientsHook from '../../hooks/useIngredients';
import * as repository from '../../features/mealPlans/inventoryQuantityRepository';
import { clearAccountLocalData, getAllIngredients, saveIngredient } from '../../db/indexedDB';

const RAW = { id: 'chicken', name: '닭고기', quantity: '반 모', expiryDate: '2026-10-01',
  consumed: false, memo: '그대로 보존할 메모', category: '육류', storageType: '냉장' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function openForm(view = screen) {
  fireEvent.click(view.getByRole('button', { name: '수량 확인 목록 열기' }));
  return within(await view.findByRole('form', { name: '닭고기 남은 수량 확인' }));
}

function enterQuantity(form, amount = '300') {
  fireEvent.change(form.getByLabelText('확인한 남은 양'), { target: { value: amount } });
  fireEvent.change(form.getByLabelText('단위'), { target: { value: 'g' } });
  fireEvent.change(form.getByLabelText('조리 상태'), { target: { value: 'raw' } });
}

async function confirmRaw(scope = 'guest', amount = 300) {
  const { inventory } = await repository.getInventoryQuantitySnapshot(scope);
  const item = inventory.find((entry) => entry.id === RAW.id);
  return repository.saveInventoryQuantity({ scope, ingredientId: RAW.id,
    expectedSourceToken: item.sourceToken, expectedRevision: item.quantityRevision,
    values: { name: '닭고기', amount, unit: 'g', preparationState: 'raw' } });
}

beforeAll(() => {
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T03:00:00.000Z'));
  for (const scope of ['guest', 'user:alice']) {
    await clearAccountLocalData(scope);
    await saveIngredient(RAW, scope);
  }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('InventoryQuantityReview', () => {
  it.each(['save', 'revoke'])('restores keyboard focus after a successful %s remounts its quantity form', async action => {
    if (action === 'revoke') await confirmRaw();
    render(<InventoryQuantityReview scope="guest" />);
    const form = await openForm();
    if (action === 'save') enterQuantity(form);
    const button = form.getByRole('button', { name: action === 'save' ? '확인한 수량 저장' : '수량 확인 취소' });
    button.focus(); fireEvent.click(button);
    await screen.findByText(action === 'save' ? '확인한 수량을 저장했어요.' : '수량 확인을 취소했어요.');
    expect(screen.getByRole('heading', { name: '남은 수량 확인' })).toHaveFocus();
  });

  it('does not reclaim focus moved outside the quantity form during a pending save', async () => {
    const gate = deferred(); const save = repository.saveInventoryQuantity;
    vi.spyOn(repository, 'saveInventoryQuantity').mockImplementationOnce(async input => {
      const result = await save(input); await gate.promise; return result;
    });
    render(<><button>다른 작업</button><InventoryQuantityReview scope="guest" /></>);
    const form = await openForm(); enterQuantity(form);
    const button = form.getByRole('button', { name: '확인한 수량 저장' });
    button.focus(); fireEvent.click(button);
    const outside = screen.getByRole('button', { name: '다른 작업' }); outside.focus();
    await act(async () => gate.resolve());
    await screen.findByText('확인한 수량을 저장했어요.');
    expect(outside).toHaveFocus();
  });

  it('requires an explicit request before showing quantity confirmation inputs', () => {
    const read = vi.spyOn(repository, 'getInventoryQuantitySnapshot');
    render(<InventoryQuantityReview scope="guest" />);
    expect(screen.queryByRole('button', { name: '수량 확인 목록 열기' })).toBeInTheDocument();
    expect(screen.queryByLabelText('확인한 남은 양')).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it('preserves raw quantity and expiry while leaving confirmation amount, unit and preparation blank', async () => {
    render(<InventoryQuantityReview scope="guest" />);
    const form = await openForm();
    expect(form.getByText(/반 모/)).toBeInTheDocument();
    expect(form.getByText(/2026-10-01/)).toBeInTheDocument();
    expect(form.getByLabelText('계산에 사용할 재료 이름')).toHaveValue('닭고기');
    expect(form.getByLabelText('확인한 남은 양')).toHaveValue(null);
    expect(form.getByLabelText('단위')).toHaveValue('');
    expect(form.getByLabelText('조리 상태')).toHaveValue('');
    expect(form.getByRole('button', { name: '확인한 수량 저장' })).toBeDisabled();
    expect(screen.getByText(/계란.*달걀.*자동/)).toBeInTheDocument();
  });

  it('persists an explicit quantity across reload without modifying raw quantity or memo', async () => {
    const before = await getAllIngredients('guest');
    const view = render(<InventoryQuantityReview scope="guest" />);
    const form = await openForm();
    enterQuantity(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 수량 저장' }));
    expect(await screen.findByText('확인한 수량을 저장했어요.')).toBeInTheDocument();
    expect(screen.getByText('사용자 확인됨', { exact: true })).toBeInTheDocument();
    expect((await repository.getInventoryQuantitySnapshot('guest')).inventory[0]).toMatchObject({
      quantityState: 'verified', quantityName: '닭고기', ingredientKey: 'food:닭고기', amount: 300, unit: 'g', preparationState: 'raw',
    });
    expect(await getAllIngredients('guest')).toEqual(before);
    view.unmount();
    render(<InventoryQuantityReview scope="guest" />);
    const restored = await openForm();
    expect(restored.getByLabelText('확인한 남은 양')).toHaveValue(300);
    expect(restored.getByLabelText('단위')).toHaveValue('g');
    expect(restored.getByLabelText('조리 상태')).toHaveValue('raw');
  });

  it('discards a confirmation after a raw edit without inferring the invalidation reason', async () => {
    await confirmRaw();
    render(<InventoryQuantityReview scope="guest" />);
    await openForm();
    await saveIngredient({ ...RAW, quantity: '새 원본 메모' }, 'guest');
    fireEvent.click(screen.getByRole('button', { name: '수량 목록 새로고침' }));
    expect(await screen.findByText('수량 확인 필요', { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText('확인한 남은 양')).toHaveValue(null);
    expect(screen.getByText(/새 원본 메모/)).toBeInTheDocument();
    expect(screen.queryByText('사용자 확인됨', { exact: true })).not.toBeInTheDocument();
  });

  it('revokes a confirmation without consuming or deleting the original ingredient', async () => {
    await confirmRaw();
    const before = await getAllIngredients('guest');
    render(<InventoryQuantityReview scope="guest" />);
    const form = await openForm();
    fireEvent.click(form.getByRole('button', { name: '수량 확인 취소' }));
    expect(await screen.findByText('수량 확인을 취소했어요.')).toBeInTheDocument();
    expect(screen.getByText('수량 확인 필요', { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText('확인한 남은 양')).toHaveValue(null);
    expect((await repository.getInventoryQuantitySnapshot('guest')).inventory[0].quantityState).toBe('unverified');
    expect(await getAllIngredients('guest')).toEqual(before);
  });

  it('blocks an older open form from overwriting another form’s confirmed amount', async () => {
    const first = render(<InventoryQuantityReview scope="guest" />);
    const second = render(<InventoryQuantityReview scope="guest" />);
    const firstQueries = within(first.container);
    const secondQueries = within(second.container);
    const firstForm = await openForm(firstQueries);
    const secondForm = await openForm(secondQueries);
    enterQuantity(firstForm, '200');
    enterQuantity(secondForm, '300');
    fireEvent.click(firstForm.getByRole('button', { name: '확인한 수량 저장' }));
    await firstQueries.findByText('확인한 수량을 저장했어요.');
    fireEvent.click(secondForm.getByRole('button', { name: '확인한 수량 저장' }));
    expect(await secondQueries.findByRole('alert')).toHaveTextContent('새로고침');
    expect(secondQueries.queryByText('확인한 수량을 저장했어요.')).not.toBeInTheDocument();
    expect((await repository.getInventoryQuantitySnapshot('guest')).inventory[0].amount).toBe(200);
    fireEvent.click(secondQueries.getByRole('button', { name: '수량 목록 새로고침' }));
    expect(await secondQueries.findByDisplayValue('200')).toBeInTheDocument();
  });

  it('does not announce success or allow a duplicate save while persistence is pending', async () => {
    const gate = deferred();
    const save = repository.saveInventoryQuantity;
    const saveSpy = vi.spyOn(repository, 'saveInventoryQuantity').mockImplementationOnce(async (input) => {
      const record = await save(input);
      await gate.promise;
      return record;
    });
    render(<InventoryQuantityReview scope="guest" />);
    const form = await openForm();
    enterQuantity(form);
    const button = form.getByRole('button', { name: '확인한 수량 저장' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.queryByText('사용자 확인됨', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('확인한 수량을 저장했어요.')).not.toBeInTheDocument();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); });
    expect(await screen.findByText('확인한 수량을 저장했어요.')).toBeInTheDocument();
  });

  it('keeps user inputs after a failed save and offers an explicit refresh', async () => {
    vi.spyOn(repository, 'saveInventoryQuantity').mockRejectedValueOnce(new Error('저장 실패'));
    render(<InventoryQuantityReview scope="guest" />);
    const form = await openForm();
    enterQuantity(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 수량 저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('새로고침');
    expect(screen.getByLabelText('확인한 남은 양')).toHaveValue(300);
    expect(screen.queryByText('확인한 수량을 저장했어요.')).not.toBeInTheDocument();
    expect((await repository.getInventoryQuantitySnapshot('guest')).inventory[0].quantityState).toBe('unverified');
  });

  it('does not expose a previous account’s late snapshot after switching accounts', async () => {
    const pending = deferred();
    const guest = await repository.getInventoryQuantitySnapshot('guest');
    vi.spyOn(repository, 'getInventoryQuantitySnapshot').mockReturnValueOnce(pending.promise);
    const view = render(<InventoryQuantityReview scope="guest" />);
    fireEvent.click(screen.getByRole('button', { name: '수량 확인 목록 열기' }));
    view.rerender(<InventoryQuantityReview scope="user:alice" />);
    await act(async () => { pending.resolve(guest); });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '수량 확인 목록 열기' })).toBeEnabled();
    await openForm();
    expect(screen.getByText('수량 확인 필요', { exact: true })).toBeInTheDocument();
  });

  it('does not carry a previous account’s late save success into the new account', async () => {
    const pending = deferred();
    const save = repository.saveInventoryQuantity;
    vi.spyOn(repository, 'saveInventoryQuantity').mockImplementationOnce(async (input) => {
      const record = await save(input);
      await pending.promise;
      return record;
    });
    const view = render(<InventoryQuantityReview scope="guest" />);
    const form = await openForm();
    enterQuantity(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 수량 저장' }));
    view.rerender(<InventoryQuantityReview scope="user:alice" />);
    await act(async () => { pending.resolve(); });
    expect(screen.queryByText('확인한 수량을 저장했어요.')).not.toBeInTheDocument();
    await openForm();
    expect(screen.getByLabelText('확인한 남은 양')).toHaveValue(null);
    expect((await repository.getInventoryQuantitySnapshot('user:alice')).inventory[0].quantityState).toBe('unverified');
  });

  it('hides loaded confirmations when the source reset key changes', async () => {
    await confirmRaw();
    const view = render(<InventoryQuantityReview scope="guest" resetKey="first" />);
    await openForm();
    expect(screen.getByLabelText('확인한 남은 양')).toHaveValue(300);
    view.rerender(<InventoryQuantityReview scope="guest" resetKey="changed" />);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '수량 확인 목록 열기' })).toBeEnabled();
  });

  it('hides old numbers on window focus and requires a new explicit read', async () => {
    await confirmRaw();
    const read = vi.spyOn(repository, 'getInventoryQuantitySnapshot');
    render(<InventoryQuantityReview scope="guest" />);
    await openForm();
    fireEvent.focus(window);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByText(/다시 불러/)).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '수량 목록 새로고침' }));
    expect(await screen.findByDisplayValue('300')).toBeInTheDocument();
  });

  it('recovers from a failed read without showing any editable confirmation', async () => {
    vi.spyOn(repository, 'getInventoryQuantitySnapshot').mockRejectedValueOnce(new Error('읽기 실패'));
    render(<InventoryQuantityReview scope="guest" />);
    fireEvent.click(screen.getByRole('button', { name: '수량 확인 목록 열기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('새로고침');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '수량 목록 새로고침' }));
    expect(await screen.findByRole('form', { name: '닭고기 남은 수량 확인' })).toBeInTheDocument();
  });

  it('uses the ingredient page account and closes old quantities immediately after a source change', async () => {
    await confirmRaw('user:alice');
    vi.spyOn(authHook, 'useAuth').mockReturnValue({ storageScope: 'user:alice', loading: false });
    const ingredients = { ingredients: await getAllIngredients('user:alice'), loading: false, error: '',
      removeIngredient: vi.fn(), updateIngredient: vi.fn() };
    const readIngredients = vi.spyOn(ingredientsHook, 'useIngredients').mockReturnValue(ingredients);
    const view = render(<MemoryRouter><IngredientsPage /></MemoryRouter>);
    const form = await openForm();
    expect(form.getByLabelText('확인한 남은 양')).toHaveValue(300);
    await saveIngredient({ ...RAW, quantity: '원본 수정됨' }, 'user:alice');
    readIngredients.mockReturnValue({ ...ingredients, ingredients: await getAllIngredients('user:alice') });
    view.rerender(<MemoryRouter><IngredientsPage /></MemoryRouter>);
    expect(screen.queryByRole('form', { name: '닭고기 남은 수량 확인' })).not.toBeInTheDocument();
    expect(screen.queryByText('사용자 확인됨', { exact: true })).not.toBeInTheDocument();
    const refreshed = await openForm();
    expect(refreshed.getByLabelText('확인한 남은 양')).toHaveValue(null);
    expect(refreshed.getByText(/원본 수정됨/)).toBeInTheDocument();
    expect((await repository.getInventoryQuantitySnapshot('guest')).inventory[0].quantityState).toBe('unverified');
  });

  it('blocks the ingredient page quantity read while the account is loading', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({ storageScope: 'guest', loading: true });
    vi.spyOn(ingredientsHook, 'useIngredients').mockReturnValue({ ingredients: [RAW], loading: false, error: '',
      removeIngredient: vi.fn(), updateIngredient: vi.fn() });
    const read = vi.spyOn(repository, 'getInventoryQuantitySnapshot');
    render(<MemoryRouter><IngredientsPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '수량 확인 목록 열기' })).toBeDisabled();
    expect(read).not.toHaveBeenCalled();
  });
});
