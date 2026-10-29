import { createElement } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IngredientsProvider, useIngredients } from '../useIngredients';
import * as database from '../../db/indexedDB';
import * as importRepository from '../../features/import/ingredientImportRepository';
import { clearScopeState, getScopeState } from '../../features/ingredients/ingredientsScopeState';

const state = vi.hoisted(() => ({ scope: 'guest', backend: false, authenticated: false }));
vi.mock('../useAuth', () => ({ useAuth: () => ({ storageScope: state.scope, isAuthenticated: state.authenticated }) }));
vi.mock('../../utils/backendConfig', () => ({ isBackendEnabled: () => state.backend }));
const NOW = '2026-09-28T03:00:00.000Z';
const SCOPES = ['guest', 'user:import-a', 'user:import-b'];
const item = (id, name = '두부') => ({ id, clientId: id, name, quantity: '2팩', category: '두부/콩',
  storageType: '냉장', purchaseDate: '2026-09-28', expiryDate: '2026-10-05', consumed: false, memo: '사용자 메모' });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const readStoredIngredients = database.getAllIngredients;
function delayNextInventoryRead({ fail = false } = {}) {
  const ready = deferred();
  const release = deferred();
  vi.spyOn(database, 'getAllIngredients').mockImplementationOnce(async (...args) => {
    // Keep the actual scoped read and delay only delivery of its result.
    const rows = await readStoredIngredients(...args);
    ready.resolve();
    await release.promise;
    if (fail) throw new Error('previous account private read failure');
    return rows;
  });
  return { ready: ready.promise, release: release.resolve };
}
async function renderInventory() {
  const view = renderHook(() => useIngredients(), {
    wrapper: ({ children }) => createElement(IngredientsProvider, null, children),
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}
async function prepare(view, values = {}) {
  // An absent integration API must fail as an assertion, not an import error.
  expect(view.result.current.importIngredients).toBeTypeOf('function');
  const repository = importRepository;
  return { repository, command: repository.prepareIngredientImport({ scope: state.scope,
    items: [item('new-tofu')], replacements: [], syncEnabled: state.backend && state.authenticated,
    now: NOW, ...values }) };
}
async function setAccount(view, scope) {
  state.scope = scope; state.authenticated = scope !== 'guest';
  view.rerender();
  await waitFor(() => expect(view.result.current.loading).toBe(false));
}

beforeEach(async () => {
  state.scope = 'guest'; state.backend = false; state.authenticated = false;
  for (const scope of SCOPES) { clearScopeState(scope); await database.clearAccountLocalData(scope); }
});
afterEach(async () => {
  cleanup(); vi.restoreAllMocks();
  for (const scope of SCOPES) { clearScopeState(scope); await database.clearAccountLocalData(scope); }
});

describe('reviewed import integration in the real ingredient provider', () => {
  it('does not let a previous account refresh failure block the current account import', async () => {
    await database.saveIngredient(item('a-only'), 'guest');
    await database.saveIngredient(item('b-only', '당근'), 'user:import-b');
    const view = await renderInventory();
    const read = delayNextInventoryRead({ fail: true });
    let outcome;
    await act(async () => {
      outcome = view.result.current.loadIngredients({ force: true }).catch(error => error);
      await read.ready;
    });
    await setAccount(view, 'user:import-b');
    await act(async () => { read.release(); await outcome; });
    expect.soft(view.result.current.error).toBe('');
    expect(view.result.current.ingredients.map(row => row.id)).toEqual(['b-only']);
    const { command } = await prepare(view);
    await act(async () => { await view.result.current.importIngredients(command); });
    expect(view.result.current.ingredients.map(row => row.id).sort()).toEqual(['b-only', 'new-tofu']);
    expect(await readStoredIngredients('guest')).toEqual([item('a-only')]);
  });

  it('does not restore cleared account data from a late refresh after returning A-B-A', async () => {
    await database.saveIngredient(item('a-private'), 'guest');
    const view = await renderInventory();
    const read = delayNextInventoryRead();
    let outcome;
    await act(async () => {
      outcome = view.result.current.loadIngredients({ force: true }).catch(error => error);
      await read.ready;
    });
    await setAccount(view, 'user:import-b');
    await database.clearAccountLocalData('guest');
    clearScopeState('guest');
    await setAccount(view, 'guest');
    expect(view.result.current.ingredients).toEqual([]);
    await act(async () => { read.release(); await outcome; });
    expect.soft(view.result.current.ingredients).toEqual([]);
    expect.soft(getScopeState('guest').items).toEqual([]);
    expect(await readStoredIngredients('guest')).toEqual([]);
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('does not repopulate a cleared cache when the refreshing provider unmounts', async () => {
    await database.saveIngredient(item('private-before-unmount'), 'guest');
    const view = await renderInventory();
    const read = delayNextInventoryRead();
    let outcome;
    await act(async () => {
      outcome = view.result.current.loadIngredients({ force: true }).catch(error => error);
      await read.ready;
    });
    view.unmount();
    await database.clearAccountLocalData('guest');
    clearScopeState('guest');
    read.release();
    await outcome;
    expect.soft(getScopeState('guest').items).toEqual([]);
    expect(await readStoredIngredients('guest')).toEqual([]);
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('keeps the newer same-account refresh instead of a delayed older snapshot', async () => {
    await database.saveIngredient(item('tofu'), 'guest');
    const view = await renderInventory();
    const older = delayNextInventoryRead();
    let outcome;
    await act(async () => {
      outcome = view.result.current.loadIngredients({ force: true }).catch(error => error);
      await older.ready;
    });
    await database.saveIngredient({ ...item('tofu'), quantity: '3팩' }, 'guest');
    await act(async () => { await view.result.current.loadIngredients({ force: true }); });
    expect(view.result.current.ingredients[0].quantity).toBe('3팩');
    await act(async () => { older.release(); await outcome; });
    expect.soft(view.result.current.ingredients[0].quantity).toBe('3팩');
    expect.soft(getScopeState('guest').items[0].quantity).toBe('3팩');
    expect((await readStoredIngredients('guest'))[0].quantity).toBe('3팩');
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('does not end the current refresh or show an older request failure while a newer read is pending', async () => {
    await database.saveIngredient(item('tofu'), 'guest');
    const view = await renderInventory();
    const older = delayNextInventoryRead({ fail: true });
    let oldOutcome;
    await act(async () => {
      oldOutcome = view.result.current.loadIngredients({ force: true }).catch(error => error);
      await older.ready;
    });
    const newer = delayNextInventoryRead();
    let newOutcome;
    await act(async () => {
      newOutcome = view.result.current.loadIngredients({ force: true });
      await newer.ready;
    });
    await act(async () => { older.release(); await oldOutcome; });
    expect.soft(view.result.current.loading).toBe(true);
    expect.soft(view.result.current.error).toBe('');
    await act(async () => { newer.release(); await newOutcome; });
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.error).toBe('');
    expect(view.result.current.ingredients).toEqual([item('tofu')]);
  });

  it('settles both mounted providers when they share the same pending inventory read', async () => {
    await database.saveIngredient(item('shared-tofu'), 'guest');
    const read = delayNextInventoryRead();
    const wrapper = ({ children }) => createElement(IngredientsProvider, null, children);
    const first = renderHook(() => useIngredients(), { wrapper });
    await act(async () => { await read.ready; });
    const second = renderHook(() => useIngredients(), { wrapper });
    expect(first.result.current.loading).toBe(true);
    expect(second.result.current.loading).toBe(true);
    await act(async () => { read.release(); });
    expect(first.result.current.ingredients).toEqual([item('shared-tofu')]);
    expect.soft(second.result.current.ingredients).toEqual([item('shared-tofu')]);
    expect(first.result.current.loading).toBe(false);
    expect(second.result.current.loading).toBe(false);
  });

  it('reads fresh inventory for the remaining provider when the shared read owner unmounts', async () => {
    await database.saveIngredient(item('shared-tofu'), 'guest');
    const read = delayNextInventoryRead();
    const wrapper = ({ children }) => createElement(IngredientsProvider, null, children);
    const first = renderHook(() => useIngredients(), { wrapper });
    await act(async () => { await read.ready; });
    const second = renderHook(() => useIngredients(), { wrapper });
    expect(second.result.current.loading).toBe(true);
    first.unmount();
    const updated = { ...item('shared-tofu'), quantity: '3팩' };
    await database.saveIngredient(updated, 'guest');
    await act(async () => { read.release(); });
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.ingredients).toEqual([updated]);
    expect(second.result.current.error).toBe('');
    expect(getScopeState('guest').items).toEqual([updated]);
    expect(await readStoredIngredients('guest')).toEqual([updated]);
  });

  it('only replaces the displayed inventory after the atomic transaction has committed', async () => {
    await database.saveIngredients([item('old-tofu'), item('unrelated', '양파')], 'guest');
    const view = await renderInventory();
    const { repository, command } = await prepare(view, { replacements: [item('old-tofu')] });
    const gate = deferred();
    const commit = repository.commitIngredientImport;
    vi.spyOn(repository, 'commitIngredientImport').mockImplementationOnce(async (...args) => { await gate.promise; return commit(...args); });
    let pending;
    act(() => { pending = view.result.current.importIngredients(command); });
    expect(view.result.current.ingredients.map(row => row.id).sort()).toEqual(['old-tofu', 'unrelated']);
    expect((await database.getAllIngredients('guest')).map(row => row.id).sort()).toEqual(['old-tofu', 'unrelated']);
    await act(async () => { gate.resolve(); await pending; });
    expect(view.result.current.ingredients.map(row => row.id).sort()).toEqual(['new-tofu', 'unrelated']);
    expect(view.result.current.ingredients.find(row => row.id === 'unrelated')).toEqual(item('unrelated', '양파'));
    expect(view.result.current.ingredients).toEqual(await database.getAllIngredients('guest'));
    expect(view.result.current.error).toBe('');
  });

  it('preserves inventory and surfaces an aborted write, then retries the same command', async () => {
    await database.saveIngredients([item('old-tofu')], 'guest');
    const view = await renderInventory();
    const { command } = await prepare(view, { replacements: [item('old-tofu')] });
    vi.spyOn(database, 'runInventoryQuantityTransaction').mockRejectedValueOnce(new Error('private disk failure detail'));
    await act(async () => { await expect(view.result.current.importIngredients(command)).rejects.toThrow(/저장하지 못.*다시/); });
    // The caller receives the rejection; do not poison the provider's load gate and prevent retry.
    expect(view.result.current.error).toBe('');
    expect(view.result.current.ingredients).toEqual([item('old-tofu')]);
    expect(await database.getAllIngredients('guest')).toEqual([item('old-tofu')]);
    await act(async () => { await view.result.current.importIngredients(command); });
    expect(view.result.current.ingredients.map(row => row.id)).toEqual(['new-tofu']);
    expect(view.result.current.error).toBe('');
  });

  it('keeps authenticated imports local and marks both the new row and compact deletion pending', async () => {
    state.scope = 'user:import-a'; state.backend = true; state.authenticated = true;
    await database.saveIngredients([item('old-tofu')], state.scope);
    const view = await renderInventory();
    const before = view.result.current.ingredients.find(row => row.id === 'old-tofu');
    const { command } = await prepare(view, { replacements: [before] });
    await act(async () => { await view.result.current.importIngredients(command); });
    expect(view.result.current.ingredients).toEqual([expect.objectContaining({ id: 'new-tofu', syncState: 'pendingCreate', quantity: '2팩' })]);
    expect(view.result.current.syncSummary.pendingUploads.map(row => [row.id, row.syncState]).sort()).toEqual([
      ['new-tofu', 'pendingCreate'], ['old-tofu', 'pendingDelete'],
    ]);
    expect(view.result.current.syncSummary.pendingUploads.find(row => row.id === 'old-tofu')).not.toHaveProperty('memo');
    expect(view.result.current.hasUnsyncedChanges).toBe(true);
    expect(view.result.current.syncStatus).toBe('dirty');
    expect(view.result.current.dataSource).toBe('indexeddb');
    expect(await database.getAllIngredients('user:import-b')).toEqual([]);
  });

  it('rejects a command for another scope or sync mode before any storage change', async () => {
    const view = await renderInventory();
    const { command } = await prepare(view);
    for (const wrong of [{ ...command, scope: 'user:import-a' }, { ...command, syncEnabled: true }]) {
      await act(async () => { await expect(view.result.current.importIngredients(wrong)).rejects.toThrow(); });
    }
    for (const scope of SCOPES) expect(await database.getAllIngredients(scope)).toEqual([]);
    expect(view.result.current.ingredients).toEqual([]);
  });

  it('rejects a delayed transaction after account change without showing the old error in the new account', async () => {
    await database.saveIngredients([item('b-only', '당근')], 'user:import-b');
    const view = await renderInventory();
    const { repository, command } = await prepare(view);
    const gate = deferred();
    const commit = repository.commitIngredientImport;
    vi.spyOn(repository, 'commitIngredientImport').mockImplementationOnce(async (...args) => { await gate.promise; return commit(...args); });
    let outcome;
    act(() => { outcome = view.result.current.importIngredients(command).catch(error => error); });
    await setAccount(view, 'user:import-b');
    await act(async () => { gate.resolve(); expect(await outcome).toBeInstanceOf(Error); });
    expect(view.result.current.ingredients.map(row => row.id)).toEqual(['b-only']);
    expect(view.result.current.error).toBe('');
    expect(view.result.current.hasUnsyncedChanges).toBe(false);
    expect(await database.getAllIngredients('guest')).toEqual([]);
  });

  it('keeps an already committed old-account acknowledgement out of the new account cache', async () => {
    await database.saveIngredients([item('b-only', '당근')], 'user:import-b');
    const view = await renderInventory();
    const { repository, command } = await prepare(view);
    const committed = deferred(); const ack = deferred();
    const commit = repository.commitIngredientImport;
    vi.spyOn(repository, 'commitIngredientImport').mockImplementationOnce(async (...args) => {
      const result = await commit(...args); committed.resolve(); await ack.promise; return result;
    });
    let pending;
    await act(async () => { pending = view.result.current.importIngredients(command); await committed.promise; });
    await setAccount(view, 'user:import-b');
    await act(async () => { ack.resolve(); await pending; });
    expect(view.result.current.ingredients.map(row => row.id)).toEqual(['b-only']);
    expect(view.result.current.error).toBe('');
    expect(view.result.current.hasUnsyncedChanges).toBe(false);
    expect((await database.getAllIngredients('guest')).map(row => row.id)).toEqual(['new-tofu']);
    await setAccount(view, 'guest');
    await waitFor(() => expect(view.result.current.ingredients.map(row => row.id)).toEqual(['new-tofu']));
  });

  it('refuses to start a delayed write after the provider has unmounted', async () => {
    const view = await renderInventory();
    const { repository, command } = await prepare(view);
    const gate = deferred();
    const commit = repository.commitIngredientImport;
    vi.spyOn(repository, 'commitIngredientImport').mockImplementationOnce(async (...args) => { await gate.promise; return commit(...args); });
    let outcome;
    act(() => { outcome = view.result.current.importIngredients(command).catch(error => error); });
    view.unmount();
    gate.resolve();
    expect(await outcome).toBeInstanceOf(Error);
    expect(await database.getAllIngredients('guest')).toEqual([]);
  });

  it('refreshes the active account after returning A-B-A before an acknowledged import finishes', async () => {
    await database.saveIngredients([item('old-tofu')], 'guest');
    const view = await renderInventory();
    const { repository, command } = await prepare(view, { replacements: [item('old-tofu')] });
    const committed = deferred(); const ack = deferred();
    const commit = repository.commitIngredientImport;
    vi.spyOn(repository, 'commitIngredientImport').mockImplementationOnce(async (...args) => {
      const result = await commit(...args); committed.resolve(); await ack.promise; return result;
    });
    let pending;
    await act(async () => { pending = view.result.current.importIngredients(command); await committed.promise; });
    await setAccount(view, 'user:import-b');
    await setAccount(view, 'guest');
    await act(async () => { ack.resolve(); await pending; });
    await waitFor(() => expect(view.result.current.ingredients.map(row => row.id)).toEqual(['new-tofu']));
    expect(view.result.current.ingredients).toEqual(await database.getAllIngredients('guest'));
    expect(view.result.current.error).toBe('');
  });

  it('does not resurrect an explicitly cleared account cache after an A-B-A switch and late acknowledgement', async () => {
    state.scope = 'user:import-a'; state.authenticated = true;
    const view = await renderInventory();
    const { repository, command } = await prepare(view);
    const committed = deferred(); const ack = deferred();
    const commit = repository.commitIngredientImport;
    vi.spyOn(repository, 'commitIngredientImport').mockImplementationOnce(async (...args) => {
      const result = await commit(...args); committed.resolve(); await ack.promise; return result;
    });
    let pending;
    await act(async () => { pending = view.result.current.importIngredients(command); await committed.promise; });
    await setAccount(view, 'user:import-b');
    await database.clearAccountLocalData('user:import-a'); clearScopeState('user:import-a');
    await setAccount(view, 'user:import-a');
    expect(view.result.current.ingredients).toEqual([]);
    await act(async () => { ack.resolve(); await pending; });
    expect(view.result.current.ingredients).toEqual([]);
    expect(getScopeState('user:import-a').items).toEqual([]);
    expect(await database.getAllIngredients('user:import-a')).toEqual([]);
  });

  it('does not turn a successful write into a failure when a separate refresh read is unavailable', async () => {
    const view = await renderInventory();
    const { command } = await prepare(view);
    vi.spyOn(database, 'getAllIngredients').mockRejectedValue(new Error('별도 재조회 실패'));
    await act(async () => { await view.result.current.importIngredients(command); });
    expect(view.result.current.ingredients.map(row => row.id)).toEqual(['new-tofu']);
    expect(view.result.current.error).toBe('');
  });
});
