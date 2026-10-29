import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportPage from '../ImportPage';
import { IngredientsProvider } from '../../hooks/useIngredients';
import * as authHook from '../../hooks/useAuth';
import * as database from '../../db/indexedDB';
import * as importRepository from '../../features/import/ingredientImportRepository';
import { clearScopeState } from '../../features/ingredients/ingredientsScopeState';

const SCOPE = 'user:import-storage-test';
const STORAGE_KEY = `fridgemate-import-corrections:v2:${SCOPE}`;
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), (character) => character.charCodeAt(0));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/import']}>
      <IngredientsProvider>
        <Routes>
          <Route path="/import" element={<ImportPage />} />
          <Route path="/ingredients" element={<h1>저장된 냉장고</h1>} />
        </Routes>
      </IngredientsProvider>
    </MemoryRouter>
  );
}

async function extractImage(name = 'receipt.png') {
  fireEvent.change(screen.getByLabelText(/사진 고르기/), {
    target: { files: [new File([PNG], name, { type: 'image/png' })] }
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '사진에서 재료 찾기' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '사진에서 재료 찾기' }));
  await screen.findByRole('button', { name: '선택 항목 저장' });
  await waitFor(() => expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled());
}

function rejectLearningWrites() {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === STORAGE_KEY) throw new DOMException('private quota detail', 'QuotaExceededError');
    return original.call(this, key, value);
  });
}

beforeEach(async () => {
  localStorage.clear();
  clearScopeState(SCOPE);
  await database.clearIngredients(SCOPE);
  vi.spyOn(authHook, 'useAuth').mockReturnValue({ isAuthenticated: false, storageScope: SCOPE });
  // Only expensive OCR recognition is replaced; validation, parsing, review, learning and IndexedDB are real.
  window.__FRIDGEMATE_TEST__ = { extractTextFromImage: async () => ({ text: '두부 1모', lineItems: [] }) };
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  delete window.__FRIDGEMATE_TEST__;
  clearScopeState(SCOPE);
  await database.clearIngredients(SCOPE);
  localStorage.clear();
});

describe('OCR auxiliary learning storage failures', () => {
  it('does not silently select another duplicate when the initially selected candidate is deselected', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 두부: { name: '두부' }, 오이: { name: '두부' } }));
    window.__FRIDGEMATE_TEST__.extractTextFromImage = async () => ({
      text: [
        '2026. 3. 18 주문',
        '배송완료 · 3/19(목) 도착',
        '로켓프레시 국내산 두부 찌개용 2,990원 · 1개 장바구니 담기',
        '로켓프레시 국내산 오이 1,990원 · 2개입 장바구니 담기'
      ].join('\n'),
      lineItems: []
    });
    renderPage();
    await extractImage();

    const choices = screen.getAllByRole('checkbox', { name: /^이 항목 가져오기:/ });
    expect(choices).toHaveLength(2);
    expect(choices[0]).toBeChecked();
    expect(choices[1]).not.toBeChecked();
    expect(screen.getByText('전체 2개 중 1개 선택됨')).toBeInTheDocument();

    fireEvent.click(choices[0]);
    expect(choices[0]).not.toBeChecked();
    expect(choices[1]).not.toBeChecked();
    expect(screen.getByText('전체 2개 중 0개 선택됨')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    expect(await screen.findByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/최소 1개 이상 선택/);
    expect(await database.getAllIngredients(SCOPE)).toEqual([]);
  });

  it('still saves inventory and distinguishes learning failure without offering the saved candidates again', async () => {
    rejectLearningWrites();
    renderPage();
    await extractImage();
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), { target: { value: '손두부' } });
    fireEvent.change(screen.getByRole('textbox', { name: '수량' }), { target: { value: '1모' } });
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));

    expect(await screen.findByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/1개.*저장/);
    expect(screen.getByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/보정.*저장하지 못/);
    expect(screen.queryByRole('button', { name: '선택 항목 저장' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '냉장고 보기' })).toHaveAttribute('href', '/ingredients');
    expect(await database.getAllIngredients(SCOPE)).toEqual([expect.objectContaining({ name: '손두부', quantity: '1모' })]);
    expect(screen.queryByText(/private quota detail/)).not.toBeInTheDocument();

    // Starting a fresh parse is an explicit new input, not a permanently disabled import page.
    window.__FRIDGEMATE_TEST__.extractTextFromImage = async () => ({ text: '양파 2개', lineItems: [] });
    fireEvent.click(screen.getByRole('button', { name: '사진에서 재료 찾기' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('양파'));
    expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled();
    expect(screen.queryByRole('status', { name: '가져오기 결과' })).not.toBeInTheDocument();

    window.__FRIDGEMATE_TEST__.extractTextFromImage = async () => ({ text: '우유 1L', lineItems: [] });
    await extractImage('next-receipt.png');
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('우유');
    expect(await database.getAllIngredients(SCOPE)).toHaveLength(1);
  });

  it('preserves edited candidates and permits retry when inventory itself fails', async () => {
    renderPage();
    await extractImage();
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), { target: { value: '손두부' } });
    vi.spyOn(importRepository, 'commitIngredientImport').mockRejectedValueOnce(new Error('재고 저장 실패'));
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));

    expect(await screen.findByText('재고 저장 실패')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('손두부');
    expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled();
    expect(await database.getAllIngredients(SCOPE)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(await database.getAllIngredients(SCOPE)).toEqual([expect.objectContaining({ name: '손두부' })]);
  });

  it('keeps successful normal imports navigating to the inventory', async () => {
    renderPage();
    await extractImage();
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(await database.getAllIngredients(SCOPE)).toEqual([expect.objectContaining({ name: '두부' })]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toHaveProperty('두부');
  });

  it('retains manual review edits if both learning and inventory writes fail', async () => {
    rejectLearningWrites();
    renderPage();
    await extractImage();
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), { target: { value: '손두부' } });
    fireEvent.change(screen.getByRole('textbox', { name: '수량' }), { target: { value: '3모' } });
    vi.spyOn(importRepository, 'commitIngredientImport').mockRejectedValueOnce(new Error('재고 저장 실패'));
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));

    expect(await screen.findByText('재고 저장 실패')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('손두부');
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('3모');
    expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled();
    expect(await database.getAllIngredients(SCOPE)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await waitFor(() => expect(screen.getByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/1개.*저장/));
    expect(await database.getAllIngredients(SCOPE)).toEqual([expect.objectContaining({ name: '손두부', quantity: '3모' })]);
  });
});
