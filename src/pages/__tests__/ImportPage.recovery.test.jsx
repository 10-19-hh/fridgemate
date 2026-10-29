import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportPage from '../ImportPage';
import { IngredientsProvider } from '../../hooks/useIngredients';
import * as authHook from '../../hooks/useAuth';
import * as database from '../../db/indexedDB';
import * as importRepository from '../../features/import/ingredientImportRepository';
import { clearScopeState } from '../../features/ingredients/ingredientsScopeState';
import { generateMealPlan } from '../../features/mealPlans/mealPlanDomain';
import { getMealPlan, saveMealPlan } from '../../features/mealPlans/mealPlanRepository';

const ACCOUNT = 'user:recovery-a';
const OTHER = 'user:recovery-b';
const LEGACY_KEY = 'fridgemate-import-corrections';
const key = scope => `fridgemate-import-corrections:v2:${scope}`;
const DAMAGED = '{"private-ocr-input":"never-render-this-receipt"';
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const auth = { isAuthenticated: false, storageScope: ACCOUNT };

function App() {
  return <MemoryRouter initialEntries={['/import']}><IngredientsProvider><Routes>
    <Route path="/import" element={<ImportPage />} />
    <Route path="/ingredients" element={<h1>저장된 냉장고</h1>} />
  </Routes></IngredientsProvider></MemoryRouter>;
}

function panel() {
  const region = screen.queryByRole('region', { name: '이 기기의 보정 기록' });
  expect(region).toBeInTheDocument();
  return region;
}

function openConfirmation() {
  fireEvent.click(within(panel()).getByRole('button', { name: '보정 기록 초기화' }));
  return within(panel()).getByRole('button', { name: '초기화 확인' });
}

async function review() {
  fireEvent.change(screen.getByLabelText(/사진 고르기/), {
    target: { files: [new File([PNG], 'receipt.png', { type: 'image/png' })] }
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '사진에서 재료 찾기' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '사진에서 재료 찾기' }));
  await screen.findByRole('button', { name: '선택 항목 저장' });
  await waitFor(() => expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled());
}

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(async () => {
  localStorage.clear();
  auth.storageScope = ACCOUNT;
  for (const scope of ['guest', ACCOUNT, OTHER]) {
    clearScopeState(scope);
    await database.clearAccountLocalData(scope);
  }
  vi.spyOn(authHook, 'useAuth').mockImplementation(() => auth);
  // Only recognition is substituted; parsing, review, storage and providers are real.
  window.__FRIDGEMATE_TEST__ = { extractTextFromImage: async () => ({ text: '두부 1모', lineItems: [] }) };
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  delete window.__FRIDGEMATE_TEST__;
  for (const scope of ['guest', ACCOUNT, OTHER]) {
    clearScopeState(scope);
    await database.clearAccountLocalData(scope);
  }
  localStorage.clear();
});

describe('explicit local OCR correction recovery', () => {
  it('does not recommend deleting readable corrections even when a later learning write hits quota', async () => {
    localStorage.setItem(key(ACCOUNT), '{}');
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (name, value) {
      if (name === key(ACCOUNT)) throw new DOMException('private quota reason', 'QuotaExceededError');
      return write.call(this, name, value);
    });
    render(<App />);
    expect(screen.queryByRole('region', { name: '이 기기의 보정 기록' })).not.toBeInTheDocument();
    fireEvent.focus(window);
    expect(screen.queryByRole('region', { name: '이 기기의 보정 기록' })).not.toBeInTheDocument();
    await review();
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    expect(await screen.findByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/보정.*저장하지 못/);
    expect(screen.queryByRole('button', { name: '보정 기록 초기화' })).not.toBeInTheDocument();
    expect(await database.getAllIngredients(ACCOUNT)).toHaveLength(1);
    expect(localStorage.getItem(key(ACCOUNT))).toBe('{}');
  });

  it('requires explicit confirmation and preserves inventory, meal plans and edited OCR input through cancel and reset', async () => {
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    await database.saveIngredient({ id: 'existing', name: '두부', quantity: '1모', memo: '재고 메모', consumed: false }, ACCOUNT);
    await saveMealPlan(generateMealPlan({ weekStart: '2026-10-05', scope: ACCOUNT,
      preferences: { servings: 2, dinnerDays: [0], excludedIngredients: [] }, now: '2026-09-28T03:00:00.000Z' }), ACCOUNT, 0);
    const inventoryBefore = await database.getAllIngredients(ACCOUNT);
    const planBefore = await getMealPlan('2026-10-05', ACCOUNT);
    render(<App />);
    expect(panel()).toHaveTextContent(/손상/);
    expect(panel()).not.toHaveTextContent(/private-ocr-input|never-render-this-receipt/);
    expect(localStorage.getItem(key(ACCOUNT))).toBe(DAMAGED);
    await review();
    fireEvent.change(screen.getByRole('textbox', { name: '수량' }), { target: { value: '3모' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ }));
    openConfirmation();
    expect(panel()).toHaveTextContent(/되돌릴 수 없/);
    expect(panel()).toHaveTextContent(/서버.*삭제하지 않/);
    expect(panel()).toHaveTextContent(/다른.*OCR.*탭.*닫/);
    fireEvent.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(localStorage.getItem(key(ACCOUNT))).toBe(DAMAGED);
    expect(within(panel()).getByRole('button', { name: '보정 기록 초기화' })).toHaveFocus();
    fireEvent.click(openConfirmation());
    expect(panel()).toHaveTextContent('이 기기의 보정 기록을 초기화했어요.');
    expect(within(panel()).getByRole('button', { name: '보정 상태 다시 확인' })).toHaveFocus();
    expect(localStorage.getItem(key(ACCOUNT))).toBeNull();
    expect(await database.getAllIngredients(ACCOUNT)).toStrictEqual(inventoryBefore);
    expect(await getMealPlan('2026-10-05', ACCOUNT)).toStrictEqual(planBefore);
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('3모');
    expect(screen.getByRole('checkbox', { name: /^이 항목 가져오기:/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(localStorage.getItem(key(ACCOUNT))).toContain('두부');
  });

  it.each(['guest', ACCOUNT])('resets only the confirmed local scope (%s)', async scope => {
    auth.storageScope = scope;
    for (const target of ['guest', ACCOUNT, OTHER]) localStorage.setItem(key(target), DAMAGED);
    localStorage.setItem(LEGACY_KEY, 'null');
    render(<App />);
    fireEvent.click(openConfirmation());
    expect(panel()).toHaveTextContent('이 기기의 보정 기록을 초기화했어요.');
    expect(localStorage.getItem(key(scope))).toBeNull();
    for (const target of ['guest', ACCOUNT, OTHER].filter(target => target !== scope)) {
      expect(localStorage.getItem(key(target))).toBe(DAMAGED);
    }
    expect(localStorage.getItem(LEGACY_KEY)).toBe(scope === 'guest' ? null : 'null');
  });

  it('distinguishes unavailable reads from damage and permits explicit rechecking without exposing storage errors', () => {
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    const read = Storage.prototype.getItem;
    let blocked = true;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (name) {
      if (blocked && name === key(ACCOUNT)) throw new Error('private read failure');
      return read.call(this, name);
    });
    render(<App />);
    expect(panel()).toHaveTextContent(/확인할 수 없|확인하지 못/);
    expect(panel()).not.toHaveTextContent(/손상|private read failure/);
    expect(within(panel()).queryByRole('button', { name: '보정 기록 초기화' })).not.toBeInTheDocument();
    blocked = false;
    fireEvent.click(within(panel()).getByRole('button', { name: '보정 상태 다시 확인' }));
    expect(within(panel()).getByRole('button', { name: '보정 기록 초기화' })).toBeEnabled();
    expect(localStorage.getItem(key(ACCOUNT))).toBe(DAMAGED);
  });

  it.each(['legacy', 'current'])('reports a failed %s deletion honestly and requires fresh confirmation before retry', (blockedKey) => {
    auth.storageScope = 'guest';
    localStorage.setItem(key('guest'), DAMAGED);
    localStorage.setItem(LEGACY_KEY, 'null');
    const remove = Storage.prototype.removeItem;
    let blocked = true;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (name) {
      if (blocked && name === (blockedKey === 'legacy' ? LEGACY_KEY : key('guest'))) throw new Error('private removal error');
      return remove.call(this, name);
    });
    render(<App />);
    fireEvent.click(openConfirmation());
    expect(panel()).toHaveTextContent(/초기화하지 못|완료하지 못/);
    expect(panel()).not.toHaveTextContent(/초기화했어요|private removal error/);
    expect(within(panel()).queryByRole('button', { name: '초기화 확인' })).not.toBeInTheDocument();
    const remaining = localStorage.getItem(key('guest'));
    expect(remaining).toBe(DAMAGED);
    blocked = false;
    expect(localStorage.getItem(key('guest'))).toBe(remaining);
    fireEvent.click(within(panel()).getByRole('button', { name: '보정 상태 다시 확인' }));
    fireEvent.click(openConfirmation());
    expect(panel()).toHaveTextContent('이 기기의 보정 기록을 초기화했어요.');
    expect(localStorage.getItem(key('guest'))).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('discards confirmation across an account switch away and back', () => {
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    localStorage.setItem(key(OTHER), 'null');
    const view = render(<App />);
    openConfirmation();
    auth.storageScope = OTHER;
    view.rerender(<App />);
    auth.storageScope = ACCOUNT;
    view.rerender(<App />);
    expect(within(panel()).queryByRole('button', { name: '초기화 확인' })).not.toBeInTheDocument();
    expect(localStorage.getItem(key(ACCOUNT))).toBe(DAMAGED);
    expect(localStorage.getItem(key(OTHER))).toBe('null');
  });

  it('ignores unrelated storage events but discards confirmation if this scope changes in another tab', () => {
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    render(<App />);
    openConfirmation();
    fireEvent(window, new StorageEvent('storage', { key: key(OTHER), newValue: 'null' }));
    expect(within(panel()).getByRole('button', { name: '초기화 확인' })).toBeEnabled();
    fireEvent(window, new StorageEvent('storage', { key: key(ACCOUNT), storageArea: sessionStorage, newValue: 'null' }));
    expect(within(panel()).getByRole('button', { name: '초기화 확인' })).toBeEnabled();
    localStorage.setItem(key(ACCOUNT), '[]');
    fireEvent(window, new StorageEvent('storage', { key: key(ACCOUNT), newValue: '[]' }));
    expect(within(panel()).queryByRole('button', { name: '초기화 확인' })).not.toBeInTheDocument();
    expect(panel()).toHaveTextContent(/바뀌|변경/);
    expect(localStorage.getItem(key(ACCOUNT))).toBe('[]');
  });

  it.each(['focus', 'confirm'])('checks for a same-tab change before %s and does not delete the changed source', action => {
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    render(<App />);
    const confirm = openConfirmation();
    localStorage.setItem(key(ACCOUNT), '[]');
    if (action === 'focus') fireEvent.focus(window);
    else fireEvent.click(confirm);
    expect(panel()).toHaveTextContent(/바뀌|변경/);
    expect(within(panel()).queryByRole('button', { name: '초기화 확인' })).not.toBeInTheDocument();
    expect(localStorage.getItem(key(ACCOUNT))).toBe('[]');
  });

  it.each(['ocr', 'save', 'refresh'])('blocks confirmation synchronously while %s is pending', async operation => {
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    render(<App />);
    await review();
    const confirm = openConfirmation();
    const pending = deferred();
    let button;
    if (operation === 'ocr') {
      window.__FRIDGEMATE_TEST__.extractTextFromImage = () => pending.promise;
      button = screen.getByRole('button', { name: '사진에서 재료 찾기' });
    } else if (operation === 'save') {
      const commit = importRepository.commitIngredientImport;
      vi.spyOn(importRepository, 'commitIngredientImport').mockImplementationOnce(async (...args) => {
        await pending.promise;
        return commit(...args);
      });
      button = screen.getByRole('button', { name: '선택 항목 저장' });
    } else {
      const read = database.getAllIngredients;
      vi.spyOn(database, 'getAllIngredients').mockImplementationOnce(async (...args) => {
        await pending.promise;
        return read(...args);
      });
      button = screen.getByRole('button', { name: '재고 다시 확인' });
    }
    try {
      act(() => { button.click(); confirm.click(); });
      expect(localStorage.getItem(key(ACCOUNT))).toBe(DAMAGED);
      expect(within(panel()).getByRole('button', { name: '초기화 확인' })).toBeDisabled();
    } finally {
      await act(async () => pending.resolve({ text: '두부 1모', lineItems: [] }));
    }
    if (operation === 'save') {
      // ACK triggers a fresh learning-state inspection; an earlier destructive
      // confirmation cannot carry over into that new saved state.
      await waitFor(() => expect(within(panel()).getByRole('button', { name: '보정 기록 초기화' })).toBeEnabled());
      expect(within(panel()).queryByRole('button', { name: '초기화 확인' })).not.toBeInTheDocument();
    } else {
      await waitFor(() => expect(within(panel()).getByRole('button', { name: '초기화 확인' })).toBeEnabled());
    }
    expect(localStorage.getItem(key(ACCOUNT))).toBe(DAMAGED);
  });

  it('rechecks after learning failure without offering an acknowledged import again', async () => {
    render(<App />);
    await review();
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    expect(await screen.findByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/보정.*저장하지 못/);
    expect(panel()).toHaveTextContent(/손상/);
    const saved = await database.getAllIngredients(ACCOUNT);
    fireEvent.click(openConfirmation());
    expect(panel()).toHaveTextContent('이 기기의 보정 기록을 초기화했어요.');
    expect(screen.queryByRole('button', { name: '선택 항목 저장' })).not.toBeInTheDocument();
    expect(await database.getAllIngredients(ACCOUNT)).toStrictEqual(saved);
  });

  it('retires an earlier reset success message when another tab writes damaged records again', () => {
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    render(<App />);
    fireEvent.click(openConfirmation());
    expect(panel()).toHaveTextContent('이 기기의 보정 기록을 초기화했어요.');
    localStorage.setItem(key(ACCOUNT), 'null');
    fireEvent(window, new StorageEvent('storage', { key: key(ACCOUNT), newValue: 'null' }));
    expect(panel()).toHaveTextContent(/손상/);
    expect(panel()).not.toHaveTextContent('이 기기의 보정 기록을 초기화했어요.');
    expect(localStorage.getItem(key(ACCOUNT))).toBe('null');
    expect(within(panel()).getByRole('button', { name: '보정 기록 초기화' })).toBeEnabled();
  });

  it('keeps the exact unresolved inventory command while resetting auxiliary corrections', async () => {
    localStorage.setItem(key(ACCOUNT), DAMAGED);
    const commit = importRepository.commitIngredientImport;
    const calls = vi.spyOn(importRepository, 'commitIngredientImport').mockImplementationOnce(async (...args) => {
      await commit(...args);
      throw new Error('저장 결과 확인 실패');
    });
    render(<App />);
    await review();
    fireEvent.change(screen.getByRole('textbox', { name: '수량' }), { target: { value: '3모' } });
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByText('저장 결과 확인 실패');
    const originalCommand = calls.mock.calls[0][0];
    const inventoryBefore = await database.getAllIngredients(ACCOUNT);
    fireEvent.click(screen.getByRole('button', { name: '재고 다시 확인' }));
    await screen.findByRole('button', { name: '이전 저장 결과 다시 확인' });
    await waitFor(() => expect(within(panel()).getByRole('button', { name: '보정 기록 초기화' })).toBeEnabled());
    fireEvent.click(openConfirmation());
    expect(panel()).toHaveTextContent('이 기기의 보정 기록을 초기화했어요.');
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('3모');
    expect(screen.getByRole('textbox', { name: '수량' })).toBeDisabled();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(await database.getAllIngredients(ACCOUNT)).toStrictEqual(inventoryBefore);
    fireEvent.click(screen.getByRole('button', { name: '이전 저장 결과 다시 확인' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(calls.mock.calls[1][0]).toBe(originalCommand);
    expect(await database.getAllIngredients(ACCOUNT)).toStrictEqual(inventoryBefore);
  });
});
