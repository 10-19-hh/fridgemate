import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportPage from '../ImportPage';
import { IngredientsProvider, useIngredients } from '../../hooks/useIngredients';
import * as authHook from '../../hooks/useAuth';
import * as analyticsHook from '../../hooks/useAnalytics';
import * as database from '../../db/indexedDB';
import * as importRepository from '../../features/import/ingredientImportRepository';
import * as backendConfig from '../../utils/backendConfig';
import * as correctionsApi from '../../api/importCorrectionsApi';
import { clearScopeState } from '../../features/ingredients/ingredientsScopeState';

const SCOPE = 'user:import-atomic-a';
const OTHER_SCOPE = 'user:import-atomic-b';
const STORAGE_KEY = `fridgemate-import-corrections:v2:${SCOPE}`;
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const auth = { isAuthenticated: false, storageScope: SCOPE };

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function InventoryProbe() {
  const { ingredients, loadIngredients } = useIngredients();
  return <><p aria-label="등록 재료 수">{ingredients.length}</p>
    <button onClick={() => loadIngredients({ force: true })}>테스트 재고 다시 읽기</button></>;
}

function App() {
  return <MemoryRouter initialEntries={['/import']}><IngredientsProvider>
    <InventoryProbe /><Routes>
      <Route path="/import" element={<ImportPage />} />
      <Route path="/ingredients" element={<h1>저장된 냉장고</h1>} />
    </Routes>
  </IngredientsProvider></MemoryRouter>;
}

function selectFile(file = new File([PNG], 'receipt.png', { type: 'image/png' })) {
  fireEvent.change(screen.getByLabelText(/사진 고르기/), { target: { files: [file] } });
}

async function startOcr() {
  selectFile();
  await waitFor(() => expect(screen.getByRole('button', { name: '사진에서 재료 찾기' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '사진에서 재료 찾기' }));
}

async function review({ inventoryReady = true } = {}) {
  await startOcr();
  await screen.findByRole('button', { name: '선택 항목 저장' });
  if (inventoryReady) await waitFor(() => expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled());
}

function stock(id, name) {
  return { id, name, quantity: '1모', category: '기타', storageType: '냉장',
    purchaseDate: '2026-09-28', expiryDate: '2026-10-10', consumed: false, memo: '기존 원문 보존' };
}

beforeEach(async () => {
  localStorage.clear();
  auth.isAuthenticated = false;
  auth.storageScope = SCOPE;
  for (const scope of [SCOPE, OTHER_SCOPE]) {
    clearScopeState(scope);
    await database.clearIngredients(scope);
  }
  vi.spyOn(authHook, 'useAuth').mockImplementation(() => auth);
  // Only expensive recognition is replaced; parsing, components, provider and IDB are real.
  window.__FRIDGEMATE_TEST__ = { extractTextFromImage: async () => ({ text: '두부 1모', lineItems: [] }) };
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete window.__FRIDGEMATE_TEST__;
  for (const scope of [SCOPE, OTHER_SCOPE]) {
    clearScopeState(scope);
    await database.clearIngredients(scope);
  }
  localStorage.clear();
});

describe('OCR review and atomic import boundaries', () => {
  it('recovers a stale replacement snapshot in place while preserving manual edits and requiring a new check', async () => {
    await database.saveIngredients([stock('original', '두부')], SCOPE);
    render(<App />);
    await review();
    fireEvent.click(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '수량' }), { target: { value: '3모' } });
    const [existing] = await database.getAllIngredients(SCOPE);
    await database.saveIngredient({ ...existing, memo: '다른 화면에서 변경한 메모' }, SCOPE);
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    expect(await screen.findByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/바뀌었습니다/);
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('3모');
    fireEvent.click(screen.getByRole('button', { name: '재고 다시 확인' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ })).not.toBeChecked());
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('3모');
    expect(screen.getByRole('checkbox', { name: /^이 항목 가져오기:/ })).toBeChecked();
    expect(screen.getByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/교체.*다시/);
    fireEvent.click(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(await database.getAllIngredients(SCOPE)).toEqual([expect.objectContaining({ name: '두부', quantity: '3모' })]);
  });

  it('recovers an initial inventory read failure without leaving the reviewed candidates', async () => {
    vi.spyOn(database, 'getAllIngredients').mockRejectedValueOnce(new Error('재고 읽기 실패'));
    render(<App />);
    await review({ inventoryReady: false });
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), { target: { value: '손두부' } });
    expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '재고 다시 확인' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('손두부');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps edits and selection through a failed refresh and only clears replacement approval after a successful refresh', async () => {
    await database.saveIngredients([stock('original', '두부')], SCOPE);
    render(<App />);
    await review();
    fireEvent.click(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '수량' }), { target: { value: '3모' } });
    vi.spyOn(database, 'getAllIngredients').mockRejectedValueOnce(new Error('재고 다시 읽기 실패'));
    fireEvent.click(screen.getByRole('button', { name: '재고 다시 확인' }));
    await waitFor(() => expect(screen.getByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/다시 확인하지 못/));
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('3모');
    expect(screen.getByRole('checkbox', { name: /^이 항목 가져오기:/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '재고 다시 확인' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ })).not.toBeChecked());
    expect(screen.getByRole('textbox', { name: '수량' })).toHaveValue('3모');
  });

  it.each([false, true])('reconfirms the original command after a lost acknowledgement and later refresh (replacement: %s)', async replacement => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T03:00:00.000Z'));
    if (replacement) await database.saveIngredients([stock('original', '두부')], SCOPE);
    const writing = deferred();
    const tracked = vi.fn();
    vi.spyOn(analyticsHook, 'useAnalytics').mockReturnValue({ trackEvent: tracked });
    const commit = importRepository.commitIngredientImport;
    const call = vi.spyOn(importRepository, 'commitIngredientImport').mockImplementationOnce(async (...args) => {
      await writing.promise;
      await commit(...args);
      throw new Error('저장 결과 확인 실패');
    });
    render(<App />);
    await review();
    if (replacement) fireEvent.click(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ }));
    const button = screen.getByRole('button', { name: '선택 항목 저장' });
    act(() => { button.click(); button.click(); });
    expect(call).toHaveBeenCalledTimes(1);
    const command = call.mock.calls[0][0];
    await act(async () => writing.resolve());
    await screen.findByText('저장 결과 확인 실패');
    const committed = await database.getAllIngredients(SCOPE);
    expect(committed).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    vi.setSystemTime(new Date('2026-09-28T03:01:00.000Z'));
    fireEvent.click(screen.getByRole('button', { name: '재고 다시 확인' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '재고 다시 확인' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('두부');
    expect(screen.getByRole('textbox', { name: '이름' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /^이 항목 가져오기:/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '사진에서 재료 찾기' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeDisabled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(tracked.mock.calls.filter(([name]) => name === 'ocr_import_saved')).toHaveLength(0);
    expect(call).toHaveBeenCalledTimes(1);
    const confirm = screen.getByRole('button', { name: '이전 저장 결과 다시 확인' });
    act(() => { confirm.click(); confirm.click(); });
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][0]).toBe(command);
    expect(await database.getAllIngredients(SCOPE)).toStrictEqual(committed);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(tracked.mock.calls.filter(([name]) => name === 'ocr_import_saved')).toHaveLength(1);
  });

  it('prepares a new command after a failed review is explicitly edited', async () => {
    const call = vi.spyOn(importRepository, 'commitIngredientImport').mockRejectedValueOnce(new Error('재고 저장 실패'));
    render(<App />);
    await review();
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByText('재고 저장 실패');
    const firstCommand = call.mock.calls[0][0];
    fireEvent.change(screen.getByRole('textbox', { name: '수량' }), { target: { value: '3모' } });
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(call.mock.calls[1][0]).not.toBe(firstCommand);
    expect(await database.getAllIngredients(SCOPE)).toEqual([expect.objectContaining({ name: '두부', quantity: '3모' })]);
  });

  it.each(['partial', 'modified'])('does not infer successful import from %s matching inventory and keeps the original request locked', async change => {
    window.__FRIDGEMATE_TEST__.extractTextFromImage = async () => ({
      text: [
        '2026. 3. 18 주문',
        '배송완료 · 3/19(목) 도착',
        '로켓프레시 국내산 두부 찌개용 2,990원 · 1개 장바구니 담기',
        '로켓프레시 국내산 오이 1,990원 · 2개입 장바구니 담기'
      ].join('\n'), lineItems: []
    });
    const tracked = vi.fn();
    vi.spyOn(analyticsHook, 'useAnalytics').mockReturnValue({ trackEvent: tracked });
    const commit = importRepository.commitIngredientImport;
    const call = vi.spyOn(importRepository, 'commitIngredientImport').mockImplementationOnce(async (...args) => {
      await commit(...args);
      throw new Error('저장 결과 확인 실패');
    });
    render(<App />);
    await review();
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByText('저장 결과 확인 실패');
    const command = call.mock.calls[0][0];
    const committed = await database.getAllIngredients(SCOPE);
    expect(committed).toHaveLength(2);
    if (change === 'partial') await database.deleteIngredient(committed[0].id, SCOPE);
    else await database.saveIngredient({ ...committed[0], memo: '다른 화면의 새 메모' }, SCOPE);
    const before = await database.getAllIngredients(SCOPE);

    fireEvent.click(screen.getByRole('button', { name: '재고 다시 확인' }));
    const confirm = await screen.findByRole('button', { name: '이전 저장 결과 다시 확인' });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(call).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getAllByRole('textbox', { name: '이름' })[0], { target: { value: '변경 금지' } });
    expect(screen.queryByDisplayValue('변경 금지')).not.toBeInTheDocument();
    fireEvent.click(confirm);
    expect(await screen.findByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/바뀌었습니다/);
    expect(call.mock.calls[1][0]).toBe(command);
    expect(await database.getAllIngredients(SCOPE)).toStrictEqual(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(tracked.mock.calls.filter(([name]) => name === 'ocr_import_saved')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: '저장된 냉장고' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: '이름' })[0]).toBeDisabled();

    // Even a later empty read cannot silently discard this unresolved command.
    for (const item of before) await database.deleteIngredient(item.id, SCOPE);
    fireEvent.click(screen.getByRole('button', { name: '재고 다시 확인' }));
    await waitFor(() => expect(screen.getByLabelText('등록 재료 수')).toHaveTextContent('0'));
    expect(screen.getByRole('button', { name: '이전 저장 결과 다시 확인' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: '이름' })[0]).toBeDisabled();

    // A new image is an explicit fresh review, never an implicit replay success.
    await waitFor(() => expect(screen.getByLabelText(/사진 고르기/)).toBeEnabled());
    selectFile(new File([PNG], 'fresh.png', { type: 'image/png' }));
    await screen.findByText('선택한 파일: fresh.png');
    expect(screen.queryByRole('button', { name: '이전 저장 결과 다시 확인' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '사진에서 재료 찾기' })).toBeEnabled();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each(['switch away and back', 'unmount'])('does not learn, transmit or navigate from a late committed response after %s', async action => {
    auth.isAuthenticated = true;
    vi.spyOn(backendConfig, 'isBackendEnabled').mockReturnValue(true);
    const remote = vi.spyOn(correctionsApi, 'saveImportCorrectionsRemote').mockResolvedValue({ savedCount: 1 });
    const tracked = [];
    vi.spyOn(analyticsHook, 'useAnalytics').mockReturnValue({ trackEvent: name => { tracked.push(name); } });
    const ack = deferred();
    let didCommit = false;
    let pendingCommit;
    const initialRead = deferred();
    const read = database.getAllIngredients;
    vi.spyOn(database, 'getAllIngredients').mockImplementationOnce(async (...args) => {
      await initialRead.promise;
      return read(...args);
    });
    const commit = importRepository.commitIngredientImport;
    const commitCall = vi.spyOn(importRepository, 'commitIngredientImport').mockImplementationOnce((...args) => {
      pendingCommit = (async () => {
        const result = await commit(...args);
        didCommit = true;
        await ack.promise;
        return result;
      })();
      return pendingCommit;
    });
    const view = render(<App />);
    try {
      await review({ inventoryReady: false });
      expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeDisabled();
      await act(async () => initialRead.resolve());
      await waitFor(() => expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
      expect(commitCall).toHaveBeenCalledTimes(1);
      // A bounded observation must precede the ACK gate; never leave an act
      // waiting forever if a disabled save button prevented the command.
      await waitFor(() => expect(didCommit).toBe(true));
      if (action === 'unmount') view.unmount();
      else {
        auth.storageScope = OTHER_SCOPE;
        view.rerender(<App />);
        auth.storageScope = SCOPE;
        view.rerender(<App />);
      }
      localStorage.removeItem(STORAGE_KEY);
      await act(async () => { ack.resolve(); await pendingCommit; });
      expect(remote).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(tracked).not.toContain('ocr_import_saved');
      expect(screen.queryByRole('heading', { name: '저장된 냉장고' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '선택 항목 저장' })).not.toBeInTheDocument();
      expect(await database.getAllIngredients(SCOPE)).toHaveLength(1);
      expect(await database.getAllIngredients(OTHER_SCOPE)).toEqual([]);
    } finally {
      view.unmount();
      await act(async () => {
        initialRead.resolve();
        ack.resolve();
        await pendingCommit;
      });
    }
  });

  it('blocks save after inventory loading fails without discarding reviewed input', async () => {
    vi.spyOn(database, 'getAllIngredients').mockRejectedValueOnce(new Error('재고 읽기 실패'));
    render(<App />);
    await review({ inventoryReady: false });
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), { target: { value: '손두부' } });
    expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('손두부');
    expect(screen.getByRole('alert')).toHaveTextContent('저장된 재고를 확인하지 못했어요');
    expect(await database.getAllIngredients(SCOPE)).toEqual([]);
  });

  it('locks file, recognition and candidate controls until the inventory write is acknowledged', async () => {
    const writing = deferred();
    const commit = importRepository.commitIngredientImport;
    render(<App />);
    await review();
    vi.spyOn(importRepository, 'commitIngredientImport').mockImplementationOnce(async (...args) => {
      await writing.promise;
      return commit(...args);
    });
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    expect.soft(screen.getByLabelText(/사진 고르기/)).toBeDisabled();
    expect.soft(screen.getByRole('button', { name: '사진에서 재료 찾기' })).toBeDisabled();
    expect.soft(screen.getByRole('textbox', { name: '이름' })).toBeDisabled();
    expect.soft(screen.getByRole('button', { name: '전체 선택' })).toBeDisabled();
    expect.soft(screen.getByRole('button', { name: '선택 항목 저장' })).toBeDisabled();
    expect.soft(screen.queryByRole('button', { name: '재고 다시 확인' })).toBeDisabled();
    expect.soft(localStorage.getItem(STORAGE_KEY)).toBeNull();
    await act(async () => writing.resolve());
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(await database.getAllIngredients(SCOPE)).toHaveLength(1);
  });

  it('keeps successful inventory confirmation when optional analytics throws', async () => {
    vi.spyOn(analyticsHook, 'useAnalytics').mockReturnValue({ trackEvent: name => {
      if (name === 'ocr_review_completed') throw new Error('분석 저장 실패');
    } });
    render(<App />);
    await review();
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await waitFor(async () => expect(await database.getAllIngredients(SCOPE)).toHaveLength(1));
    expect(screen.queryByRole('button', { name: '선택 항목 저장' })).not.toBeInTheDocument();
    expect(screen.queryByText('분석 저장 실패')).not.toBeInTheDocument();
  });

  it('clears the image, source text and reviewed candidates when the account changes', async () => {
    const view = render(<App />);
    await review();
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('두부');
    auth.storageScope = OTHER_SCOPE;
    view.rerender(<App />);
    expect(screen.queryByRole('textbox', { name: '이름' })).not.toBeInTheDocument();
    expect(screen.queryByText(/선택한 파일:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '사진에서 재료 찾기' })).toBeDisabled();
    expect(screen.queryByText('두부 1모')).not.toBeInTheDocument();
  });

  it('ignores a late OCR response after switching away from and back to the original account', async () => {
    const recognition = deferred();
    window.__FRIDGEMATE_TEST__.extractTextFromImage = () => recognition.promise;
    const view = render(<App />);
    await startOcr();
    auth.storageScope = OTHER_SCOPE;
    view.rerender(<App />);
    auth.storageScope = SCOPE;
    view.rerender(<App />);
    await act(async () => recognition.resolve({ text: '이전계정두부 1모', lineItems: [] }));
    expect(screen.queryByRole('button', { name: '선택 항목 저장' })).not.toBeInTheDocument();
    expect(screen.queryByText(/이전계정두부/)).not.toBeInTheDocument();
    expect(await database.getAllIngredients(SCOPE)).toEqual([]);
  });

  it('does not let old file validation replace a newer selected image', async () => {
    const bytes = deferred();
    const oldFile = new File([PNG], 'old.png', { type: 'image/png' });
    Object.defineProperty(oldFile, 'arrayBuffer', { value: () => bytes.promise });
    render(<App />);
    selectFile(oldFile);
    selectFile(new File([PNG], 'new.png', { type: 'image/png' }));
    await screen.findByText('선택한 파일: new.png');
    await act(async () => bytes.resolve(PNG.buffer));
    expect(screen.getByText('선택한 파일: new.png')).toBeInTheDocument();
    expect(screen.queryByText('선택한 파일: old.png')).not.toBeInTheDocument();
  });

  it('discards an old OCR result when a different image was selected while recognition was pending', async () => {
    const recognition = deferred();
    window.__FRIDGEMATE_TEST__.extractTextFromImage = () => recognition.promise;
    render(<App />);
    await startOcr();
    selectFile(new File([PNG], 'new.png', { type: 'image/png' }));
    await screen.findByText('선택한 파일: new.png');
    await act(async () => recognition.resolve({ text: '이전사진두부 1모', lineItems: [] }));
    expect(screen.queryByRole('button', { name: '선택 항목 저장' })).not.toBeInTheDocument();
    expect(screen.queryByText(/이전사진두부/)).not.toBeInTheDocument();
  });

  it('keeps the initial review but blocks saving until inventory has been read', async () => {
    const loading = deferred();
    vi.spyOn(database, 'getAllIngredients').mockReturnValueOnce(loading.promise);
    render(<App />);
    await review({ inventoryReady: false });
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), { target: { value: '손두부' } });
    expect.soft(screen.getByRole('button', { name: '선택 항목 저장' })).toBeDisabled();
    await act(async () => loading.resolve([]));
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('손두부');
    expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled();
  });

  it('requires explicit replacement confirmation again after changing the selected ingredient name', async () => {
    await database.saveIngredients([stock('tofu', '두부'), stock('milk', '우유')], SCOPE);
    render(<App />);
    await review();
    fireEvent.click(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), { target: { value: '우유' } });
    expect(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ })).not.toBeChecked();
    expect(screen.getByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/이름.*교체.*다시 확인/);
    expect(await database.getAllIngredients(SCOPE)).toHaveLength(2);
  });

  it('does not expand checked replacement targets when another matching batch arrives', async () => {
    await database.saveIngredients([stock('original', '두부')], SCOPE);
    render(<App />);
    await review();
    fireEvent.click(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ }));
    await database.saveIngredients([stock('new-batch', '두부')], SCOPE);
    fireEvent.click(screen.getByRole('button', { name: '테스트 재고 다시 읽기' }));
    await waitFor(() => expect(screen.getByLabelText('등록 재료 수')).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    const saved = await database.getAllIngredients(SCOPE);
    expect(saved).toHaveLength(2);
    expect(saved).toContainEqual(expect.objectContaining({ id: 'new-batch', memo: '기존 원문 보존' }));
    expect(saved.some(item => item.id === 'original')).toBe(false);
  });

  it('preserves replaced stock and does not learn a correction when the new inventory write fails', async () => {
    await database.saveIngredients([stock('original', '두부')], SCOPE);
    const before = await database.getAllIngredients(SCOPE);
    render(<App />);
    await review();
    fireEvent.click(screen.getByRole('checkbox', { name: /^기존 1개 항목 삭제 후 가져오기:/ }));
    for (const method of ['put', 'add']) {
      const write = IDBObjectStore.prototype[method];
      vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (value, ...args) {
        if (this.name === 'ingredients' && value.name === '두부' && value.id !== 'original') {
          throw new Error('재고 저장 실패');
        }
        return write.call(this, value, ...args);
      });
    }
    fireEvent.click(screen.getByRole('button', { name: '선택 항목 저장' }));
    expect(await screen.findByRole('status', { name: '가져오기 결과' })).toHaveTextContent(/저장하지 못|저장 실패/);
    expect.soft(await database.getAllIngredients(SCOPE)).toStrictEqual(before);
    expect.soft(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveValue('두부');
    expect(screen.getByRole('button', { name: '선택 항목 저장' })).toBeEnabled();
  });
});
