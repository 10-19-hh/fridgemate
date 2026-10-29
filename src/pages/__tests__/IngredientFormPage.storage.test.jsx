import { Fragment, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IngredientFormPage from '../IngredientFormPage';
import { IngredientsProvider, useIngredients } from '../../hooks/useIngredients';
import { AnalyticsProvider } from '../../hooks/useAnalytics';
import * as authHook from '../../hooks/useAuth';
import * as database from '../../db/indexedDB';
import { clearScopeState, getScopeState } from '../../features/ingredients/ingredientsScopeState';
import { setAnalyticsConsent } from '../../utils/analyticsConsent';

const SCOPE_A = 'user:form-storage-a';
const SCOPE_B = 'user:form-storage-b';
const row = { id: 'tofu', clientId: 'tofu', name: '두부', quantity: '1모', category: '두부/콩류',
  storageType: '냉장', purchaseDate: '', expiryDate: '', memo: '', consumed: false };
let auth;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function InventoryReady() {
  const { loading } = useIngredients();
  return <output>{loading ? '재고 준비 중' : '재고 준비됨'}</output>;
}

function Harness({ strict = true }) {
  const Wrapper = strict ? StrictMode : Fragment;
  return (
    <Wrapper>
      <MemoryRouter initialEntries={['/start']}>
        <IngredientsProvider>
          <AnalyticsProvider>
            <InventoryReady />
            <nav>
              <Link to="/ingredients/tofu/edit">두부 수정 열기</Link>
              <Link to="/ingredients/onion/edit">양파 수정 열기</Link>
              <Link to="/ingredients/new">새 재료 열기</Link>
              <Link to="/elsewhere">다른 화면 열기</Link>
            </nav>
            <Routes>
              <Route path="/start" element={<p>시작 화면</p>} />
              <Route path="/ingredients/:ingredientId/edit" element={<IngredientFormPage />} />
              <Route path="/ingredients/new" element={<IngredientFormPage />} />
              <Route path="/ingredients" element={<h1>저장된 냉장고</h1>} />
              <Route path="/elsewhere" element={<h1>다른 화면</h1>} />
            </Routes>
          </AnalyticsProvider>
        </IngredientsProvider>
      </MemoryRouter>
    </Wrapper>
  );
}

async function setup() {
  const view = render(<Harness />);
  await screen.findByText('재고 준비됨');
  // Seed after the provider has loaded an empty real store, so edit lookup must
  // read IndexedDB rather than returning a previously cached row.
  await database.saveIngredient(row, SCOPE_A);
  return view;
}

async function openEdit() {
  fireEvent.click(screen.getByRole('link', { name: '두부 수정 열기' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('두부'));
}

function creationEvents() {
  return (window.__FRIDGEMATE_ANALYTICS_EVENTS__ || [])
    .filter((event) => ['ingredient_created', 'activation_completed'].includes(event.event_name));
}

beforeEach(async () => {
  vi.stubEnv('VITE_API_URL', '');
  localStorage.clear();
  sessionStorage.clear();
  for (const scope of [SCOPE_A, SCOPE_B]) {
    clearScopeState(scope);
    await database.clearIngredients(scope);
  }
  auth = { isAuthenticated: false, storageScope: SCOPE_A, loading: false };
  vi.spyOn(authHook, 'useAuth').mockImplementation(() => auth);
  setAnalyticsConsent('granted');
  window.__FRIDGEMATE_ANALYTICS_EVENTS__ = [];
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAnalyticsConsent('denied');
  for (const scope of [SCOPE_A, SCOPE_B]) {
    clearScopeState(scope);
    await database.clearIngredients(scope);
  }
  localStorage.clear();
  sessionStorage.clear();
});

describe('ingredient form storage recovery and request ownership', () => {
  it('locks every input after a failed edit lookup and reloads the original row on explicit retry', async () => {
    await setup();
    const read = vi.spyOn(database, 'getIngredientById').mockRejectedValue(new Error('private read detail'));
    fireEvent.click(screen.getByRole('link', { name: '두부 수정 열기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/불러오지 못/);
    expect(screen.queryByText(/private read detail/)).not.toBeInTheDocument();
    for (const input of document.querySelectorAll('form input, form select, form textarea')) {
      expect(input).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
    fireEvent.submit(document.querySelector('form'));
    expect(await database.getAllIngredients(SCOPE_A)).toEqual([expect.objectContaining({ id: 'tofu', name: '두부' })]);

    read.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '재료 다시 불러오기' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('두부'));
    expect(screen.getByRole('button', { name: '수정 저장' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('distinguishes a missing edit target from a read failure and does not create an empty replacement', async () => {
    await setup();
    fireEvent.click(screen.getByRole('link', { name: '양파 수정 열기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/재료를 찾을 수 없/);
    expect(screen.getByRole('textbox', { name: '이름 *' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
    fireEvent.submit(document.querySelector('form'));
    expect(await database.getAllIngredients(SCOPE_A)).toHaveLength(1);

    await database.saveIngredient({ ...row, id: 'onion', clientId: 'onion', name: '양파' }, SCOPE_A);
    fireEvent.click(screen.getByRole('button', { name: '재료 다시 불러오기' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('양파'));
    expect(screen.getByRole('button', { name: '수정 저장' })).toBeEnabled();
  });

  it('preserves manual edits after a write failure and saves them on retry without exposing raw errors', async () => {
    await setup();
    await openEdit();
    fireEvent.change(screen.getByRole('textbox', { name: '이름 *' }), { target: { value: '손두부' } });
    fireEvent.change(screen.getByRole('textbox', { name: '수량 *' }), { target: { value: '3모' } });
    vi.spyOn(database, 'saveIngredient').mockRejectedValueOnce(new Error('private quota detail'));
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/저장하지 못/);
    expect(screen.queryByText(/private quota detail/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('손두부');
    expect(screen.getByRole('textbox', { name: '수량 *' })).toHaveValue('3모');
    expect(screen.getByRole('button', { name: '수정 저장' })).toBeEnabled();
    expect((await database.getAllIngredients(SCOPE_A))[0]).toMatchObject({ name: '두부', quantity: '1모' });

    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect(await database.getAllIngredients(SCOPE_A)).toEqual([expect.objectContaining({ id: 'tofu', name: '손두부', quantity: '3모' })]);
    expect(creationEvents()).toEqual([]);
  });

  it('blocks synchronous duplicate submits and disables controls while the write acknowledgement is pending', async () => {
    await setup();
    await openEdit();
    const ack = deferred();
    const save = vi.spyOn(database, 'saveIngredient').mockImplementation(() => ack.promise);
    const form = document.querySelector('form');
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: '이름 *' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '저장 중...' })).toBeDisabled();
    await act(async () => ack.resolve());
    await screen.findByRole('heading', { name: '저장된 냉장고' });
  });

  it('does not let a late lookup for a previous route overwrite the current ingredient', async () => {
    await setup();
    await database.saveIngredient({ ...row, id: 'onion', clientId: 'onion', name: '양파' }, SCOPE_A);
    const lookup = deferred();
    const original = database.getIngredientById;
    vi.spyOn(database, 'getIngredientById').mockImplementation((id, options) => id === 'tofu' ? lookup.promise : original(id, options));
    fireEvent.click(screen.getByRole('link', { name: '두부 수정 열기' }));
    expect(screen.getByRole('textbox', { name: '이름 *' })).toBeDisabled();
    fireEvent.click(screen.getByRole('link', { name: '양파 수정 열기' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('양파'));

    await act(async () => lookup.resolve(row));
    expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('양파');
  });

  it('resets unsaved input when changing accounts and does not restore it after A to B to A', async () => {
    const view = await setup();
    await openEdit();
    fireEvent.change(screen.getByRole('textbox', { name: '이름 *' }), { target: { value: 'A의 임시 입력' } });
    await database.saveIngredient({ ...row, name: 'B의 두부' }, SCOPE_B);
    auth = { ...auth, storageScope: SCOPE_B };
    view.rerender(<Harness />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('B의 두부'));
    auth = { ...auth, storageScope: SCOPE_A };
    view.rerender(<Harness />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('두부'));
  });

  it.each([
    { mode: 'StrictMode', strict: true },
    { mode: 'single-effect Fragment', strict: false }
  ])('shows and saves only the current account row from warm same-id caches in $mode', async ({ strict }) => {
    await database.saveIngredient({ ...row, name: 'A의 두부' }, SCOPE_A);
    await database.saveIngredient({ ...row, name: 'B의 두부' }, SCOPE_B);
    const view = render(<Harness strict={strict} />);
    await screen.findByText('재고 준비됨');

    // Warm both caches through the real provider before opening an edit form.
    // A cold destination cache would fall through to IndexedDB and miss a
    // stale shared-ref lookup during the first render of an account change.
    auth = { ...auth, storageScope: SCOPE_B };
    view.rerender(<Harness strict={strict} />);
    await waitFor(() => expect(getScopeState(SCOPE_B).loaded).toBe(true));
    await screen.findByText('재고 준비됨');
    expect(getScopeState(SCOPE_A).items).toEqual([expect.objectContaining({ name: 'A의 두부' })]);
    expect(getScopeState(SCOPE_B).items).toEqual([expect.objectContaining({ name: 'B의 두부' })]);

    auth = { ...auth, storageScope: SCOPE_A };
    view.rerender(<Harness strict={strict} />);
    fireEvent.click(screen.getByRole('link', { name: '두부 수정 열기' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('A의 두부'));

    auth = { ...auth, storageScope: SCOPE_B };
    view.rerender(<Harness strict={strict} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('B의 두부'));
    fireEvent.change(screen.getByRole('textbox', { name: '수량 *' }), { target: { value: '2모' } });
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });

    expect(await database.getAllIngredients(SCOPE_A)).toEqual([
      expect.objectContaining({ id: 'tofu', name: 'A의 두부', quantity: '1모' })
    ]);
    expect(await database.getAllIngredients(SCOPE_B)).toEqual([
      expect.objectContaining({ id: 'tofu', name: 'B의 두부', quantity: '2모' })
    ]);
    expect(creationEvents()).toEqual([]);
  });

  it('ignores a lookup from an abandoned account session after A to B to A', async () => {
    const view = await setup();
    const lookup = deferred();
    const original = database.getIngredientById;
    const read = vi.spyOn(database, 'getIngredientById').mockImplementation(() => lookup.promise);
    fireEvent.click(screen.getByRole('link', { name: '두부 수정 열기' }));
    await database.saveIngredient({ ...row, name: 'B의 두부' }, SCOPE_B);
    read.mockImplementation(original);
    auth = { ...auth, storageScope: SCOPE_B };
    view.rerender(<Harness />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('B의 두부'));
    await database.saveIngredient({ ...row, name: 'A의 최신 두부' }, SCOPE_A);
    clearScopeState(SCOPE_A);
    auth = { ...auth, storageScope: SCOPE_A };
    view.rerender(<Harness />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('A의 최신 두부'));

    await act(async () => lookup.resolve({ ...row, name: 'A의 오래된 두부' }));
    expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('A의 최신 두부');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['route', 'scope', 'aba', 'unmount'])('does not emit creation analytics or navigate after a late submit acknowledgement on %s departure', async (departure) => {
    const view = await setup();
    fireEvent.click(screen.getByRole('link', { name: '새 재료 열기' }));
    fireEvent.change(screen.getByRole('textbox', { name: '이름 *' }), { target: { value: '우유' } });
    fireEvent.change(screen.getByRole('textbox', { name: '수량 *' }), { target: { value: '1통' } });
    const ack = deferred();
    vi.spyOn(database, 'saveIngredient').mockImplementation(() => ack.promise);
    fireEvent.click(screen.getByRole('button', { name: '재료 추가' }));
    if (departure === 'route') fireEvent.click(screen.getByRole('link', { name: '다른 화면 열기' }));
    if (departure === 'scope' || departure === 'aba') {
      auth = { ...auth, storageScope: SCOPE_B };
      view.rerender(<Harness />);
    }
    if (departure === 'aba') {
      auth = { ...auth, storageScope: SCOPE_A };
      view.rerender(<Harness />);
    }
    if (departure === 'unmount') view.unmount();

    await act(async () => ack.resolve());
    expect(creationEvents()).toEqual([]);
    expect(screen.queryByRole('heading', { name: '저장된 냉장고' })).not.toBeInTheDocument();
    if (departure === 'route') expect(screen.getByRole('heading', { name: '다른 화면' })).toBeInTheDocument();
    if (departure === 'scope' || departure === 'aba') expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('');
  });

  it('does not navigate after an old edit acknowledgement when the same account returns', async () => {
    const view = await setup();
    await openEdit();
    fireEvent.change(screen.getByRole('textbox', { name: '이름 *' }), { target: { value: '저장 대기 중인 입력' } });
    const ack = deferred();
    vi.spyOn(database, 'saveIngredient').mockImplementation(() => ack.promise);
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    auth = { ...auth, storageScope: SCOPE_B };
    view.rerender(<Harness />);
    await screen.findByRole('alert');
    auth = { ...auth, storageScope: SCOPE_A };
    view.rerender(<Harness />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('두부'));

    await act(async () => ack.resolve());
    expect(screen.queryByRole('heading', { name: '저장된 냉장고' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('두부');
    expect(screen.getByRole('button', { name: '수정 저장' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not leak an abandoned edit write failure into a different account form', async () => {
    const view = await setup();
    await openEdit();
    await database.saveIngredient({ ...row, name: 'B의 두부' }, SCOPE_B);
    const ack = deferred();
    vi.spyOn(database, 'saveIngredient').mockImplementation(() => ack.promise);
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
    auth = { ...auth, storageScope: SCOPE_B };
    view.rerender(<Harness />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('B의 두부'));

    await act(async () => ack.reject(new Error('private abandoned write detail')));
    expect(screen.getByRole('textbox', { name: '이름 *' })).toHaveValue('B의 두부');
    expect(screen.getByRole('button', { name: '수정 저장' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/private abandoned write detail/)).not.toBeInTheDocument();
  });

  it('keeps normal creation working with one persisted row and the two intended analytics events', async () => {
    await setup();
    fireEvent.click(screen.getByRole('link', { name: '새 재료 열기' }));
    fireEvent.change(screen.getByRole('textbox', { name: '이름 *' }), { target: { value: '우유' } });
    fireEvent.change(screen.getByRole('textbox', { name: '수량 *' }), { target: { value: '1통' } });
    fireEvent.click(screen.getByRole('button', { name: '재료 추가' }));
    await screen.findByRole('heading', { name: '저장된 냉장고' });
    expect((await database.getAllIngredients(SCOPE_A)).filter((item) => item.name === '우유')).toHaveLength(1);
    expect(creationEvents().map((event) => event.event_name)).toEqual(['ingredient_created', 'activation_completed']);
  });
});
