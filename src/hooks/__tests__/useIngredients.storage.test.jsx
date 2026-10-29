import { createElement } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IngredientsProvider, useIngredients } from '../useIngredients';
import * as database from '../../db/indexedDB';
import { clearScopeState, getScopeState } from '../../features/ingredients/ingredientsScopeState';
import { prepareIngredientImport } from '../../features/import/ingredientImportRepository';

const auth = vi.hoisted(() => ({ storageScope: 'guest', isAuthenticated: false, loading: false }));
vi.mock('../useAuth', () => ({ useAuth: () => auth }));
const SCOPES = ['guest', 'user:storage-other'];
const item = (id, name = '두부') => ({ id, clientId: id, name, quantity: '1팩', category: '두부/콩',
  storageType: '냉장', purchaseDate: '2026-09-28', expiryDate: '2026-10-05', consumed: false, memo: '기존 메모' });
const original = item('same-id');
const readStored = database.getAllIngredients;
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function renderInventory(observe) {
  return renderHook(() => {
    const value = useIngredients();
    observe?.(auth.storageScope, value);
    return value;
  }, { wrapper: ({ children }) => createElement(IngredientsProvider, null, children) });
}
async function loadedInventory() {
  const view = renderInventory();
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}
async function switchScope(view, scope) {
  auth.storageScope = scope; auth.isAuthenticated = scope !== 'guest';
  view.rerender();
  await waitFor(() => expect(view.result.current.loading).toBe(false));
}
beforeEach(async () => {
  auth.storageScope = 'guest'; auth.isAuthenticated = false;
  for (const scope of SCOPES) { clearScopeState(scope); await database.clearAccountLocalData(scope); }
  await database.saveIngredient(original, 'guest');
  await database.saveIngredient(item('same-id', '당근'), 'user:storage-other');
});
afterEach(async () => {
  cleanup(); vi.restoreAllMocks();
  for (const scope of SCOPES) { clearScopeState(scope); await database.clearAccountLocalData(scope); }
});

describe('inventory storage failure ownership', () => {
  it.each(['add', 'find'])('does not mark a failed whole-list read complete after a single-row %s', async action => {
    vi.spyOn(database, 'getAllIngredients').mockRejectedValueOnce(new Error('initial read failed'));
    const view = await loadedInventory();
    if (action === 'add') {
      await act(async () => { await view.result.current.addIngredient(item('milk', '우유')); });
    } else {
      await act(async () => { await view.result.current.findIngredient(original.id); });
    }
    expect(getScopeState('guest').loaded).toBe(false);
    await switchScope(view, 'user:storage-other');
    await switchScope(view, 'guest');
    expect(view.result.current.ingredients).toEqual(await readStored('guest'));
    expect(view.result.current.ingredients.map(row => row.id).sort()).toEqual(action === 'add' ? ['milk', 'same-id'] : ['same-id']);
    expect(view.result.current.readError).toBe('');
  });

  it.each([false, true])('does not replace an acknowledged atomic import with an older read (failure=%s)', async fail => {
    const view = await loadedInventory();
    const captured = deferred(); const pending = deferred();
    vi.spyOn(database, 'getAllIngredients').mockImplementationOnce(async (...args) => {
      const rows = await readStored(...args); captured.resolve(); await pending.promise;
      if (fail) throw new Error('old read failed');
      return rows;
    });
    let read;
    await act(async () => {
      read = view.result.current.loadIngredients({ force: true }).catch(error => error);
      await captured.promise;
    });
    const command = prepareIngredientImport({ scope: 'guest', items: [item('imported-milk', '우유')],
      replacements: [], syncEnabled: false, now: '2026-09-28T00:00:00.000Z' });
    await act(async () => { await view.result.current.importIngredients(command); });
    await act(async () => { pending.resolve(); await read; });
    expect(view.result.current.ingredients).toEqual(await readStored('guest'));
    expect(view.result.current.ingredients.map(row => row.id).sort()).toEqual(['imported-milk', 'same-id']);
    expect(view.result.current.readError).toBe('');
    expect(view.result.current.error).toBe('');
  });

  it.each(['older-first', 'newer-first'])('restores the last confirmed row after both overlapping edits fail (%s)', async order => {
    const view = await loadedInventory();
    const older = deferred(); const newer = deferred();
    vi.spyOn(database, 'saveIngredient').mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let first; let second;
    act(() => {
      first = view.result.current.updateIngredient({ ...original, quantity: '2팩' }).catch(error => error);
      second = view.result.current.updateIngredient({ ...original, quantity: '3팩' }).catch(error => error);
    });
    if (order === 'older-first') {
      await act(async () => { older.reject(new Error('first failed')); await first; });
      await act(async () => { newer.reject(new Error('second failed')); await second; });
    } else {
      await act(async () => { newer.reject(new Error('second failed')); await second; });
      await act(async () => { older.reject(new Error('first failed')); await first; });
    }
    expect(view.result.current.ingredients).toEqual([original]);
    expect(await readStored('guest')).toEqual([original]);
    expect(view.result.current.error).toMatch(/저장하지 못/);
  });

  it('preserves the earlier confirmed edit when a newer overlapping write fails', async () => {
    const view = await loadedInventory();
    const saved = deferred(); const firstGate = deferred(); const secondGate = deferred();
    const write = database.saveIngredient;
    vi.spyOn(database, 'saveIngredient').mockImplementationOnce(async (...args) => {
      await write(...args); saved.resolve(); await firstGate.promise;
    }).mockReturnValueOnce(secondGate.promise);
    let first; let second;
    await act(async () => {
      first = view.result.current.updateIngredient({ ...original, quantity: '2팩' }); await saved.promise;
    });
    act(() => { second = view.result.current.updateIngredient({ ...original, quantity: '3팩' }).catch(error => error); });
    await act(async () => { firstGate.resolve(); await first; });
    await act(async () => { secondGate.reject(new Error('second failed')); await second; });
    expect(view.result.current.ingredients).toEqual([{ ...original, quantity: '2팩' }]);
    expect(await readStored('guest')).toEqual([{ ...original, quantity: '2팩' }]);
  });

  it('distinguishes a failed initial read from empty inventory and clears the failure only after retry', async () => {
    const read = vi.spyOn(database, 'getAllIngredients').mockRejectedValue(new Error('PRIVATE disk detail'));
    const view = await loadedInventory();
    expect(view.result.current.readError).toEqual(expect.stringMatching(/불러오지 못/));
    expect(view.result.current.readError).not.toContain('PRIVATE');
    expect(view.result.current.ingredients).toEqual([]);
    expect(await readStored('guest')).toEqual([original]);
    read.mockRestore();
    await act(async () => { await view.result.current.loadIngredients({ force: true }); });
    expect(view.result.current.readError).toBe('');
    expect(view.result.current.ingredients).toEqual([original]);
  });

  it('preserves the last known rows while a refresh failure requires confirmation', async () => {
    const view = await loadedInventory();
    vi.spyOn(database, 'getAllIngredients').mockRejectedValueOnce(new Error('PRIVATE refresh'));
    await act(async () => { await expect(view.result.current.loadIngredients({ force: true })).rejects.toThrow(); });
    expect(view.result.current.ingredients).toEqual([original]);
    expect(view.result.current.readError).toEqual(expect.stringMatching(/불러오지 못/));
    expect(await readStored('guest')).toEqual([original]);
  });

  it('keeps a failed read distinguishable while a retry is still pending', async () => {
    const read = vi.spyOn(database, 'getAllIngredients').mockRejectedValueOnce(new Error('PRIVATE first read'));
    const view = await loadedInventory();
    const retry = deferred();
    read.mockReturnValueOnce(retry.promise);
    let result;
    act(() => { result = view.result.current.loadIngredients({ force: true }); });
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.readError).toEqual(expect.stringMatching(/불러오지 못/));
    await act(async () => { retry.resolve([original]); await result; });
    expect(view.result.current.readError).toBe('');
  });

  it.each([false, true])('revalidates a pre-write refresh instead of applying its outdated result (failure=%s)', async fail => {
    const view = await loadedInventory();
    const pending = deferred();
    vi.spyOn(database, 'getAllIngredients').mockImplementationOnce(async (...args) => {
      const rows = await readStored(...args);
      await pending.promise;
      if (fail) throw new Error('PRIVATE old read failure');
      return rows;
    });
    let read;
    act(() => { read = view.result.current.loadIngredients({ force: true }).catch(error => error); });
    const changed = { ...original, quantity: '3팩' };
    await act(async () => { await view.result.current.updateIngredient(changed); });
    await act(async () => { pending.resolve(); await read; });
    expect(view.result.current.ingredients).toEqual([changed]);
    expect(getScopeState('guest').items).toEqual([changed]);
    expect(view.result.current.error).toBe('');
    expect(view.result.current.readError).toBe('');
    expect(view.result.current.loading).toBe(false);
    expect(await readStored('guest')).toEqual([changed]);
  });

  it('keeps previously stored rows when creation finishes before the delayed initial read', async () => {
    const pending = deferred();
    const captured = deferred();
    vi.spyOn(database, 'getAllIngredients').mockImplementationOnce(async (...args) => {
      const rows = await readStored(...args); captured.resolve(); await pending.promise; return rows;
    });
    const view = renderInventory();
    await act(async () => { await captured.promise; });
    const added = item('new-id', '감자');
    await act(async () => { await view.result.current.addIngredient(added); });
    await act(async () => { pending.resolve(); });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.ingredients.map(row => row.id).sort()).toEqual(['new-id', 'same-id']);
    expect(view.result.current.ingredients).toEqual(await readStored('guest'));
  });

  it('reports the same failed shared initial read in both mounted providers', async () => {
    const read = deferred();
    vi.spyOn(database, 'getAllIngredients').mockReturnValueOnce(read.promise);
    const first = renderInventory();
    const second = renderInventory();
    await act(async () => { read.reject(new Error('PRIVATE shared read')); });
    expect(first.result.current.loading).toBe(false);
    expect(second.result.current.loading).toBe(false);
    expect(first.result.current.readError).toEqual(expect.stringMatching(/불러오지 못/));
    expect(second.result.current.readError).toEqual(expect.stringMatching(/불러오지 못/));
  });

  it.each([
    { action: 'addIngredient', method: 'saveIngredient', value: item('new-id') },
    { action: 'updateIngredient', method: 'saveIngredient', value: { ...original, quantity: '2팩' } },
    { action: 'addIngredients', method: 'saveIngredients', value: [item('new-id')] },
    { action: 'removeIngredient', method: 'deleteIngredient', value: original.id }
  ])('surfaces $action failure, preserves stored and visible originals, and permits retry', async ({ action, method, value }) => {
    const view = await loadedInventory();
    const write = vi.spyOn(database, method).mockRejectedValueOnce(new DOMException('PRIVATE write detail', 'QuotaExceededError'));
    await act(async () => { await expect(view.result.current[action](value)).rejects.toThrow(); });
    expect(view.result.current.error).toMatch(/저장하지 못|삭제하지 못/);
    expect(view.result.current.error).not.toContain('PRIVATE');
    expect(view.result.current.ingredients).toEqual([original]);
    expect(await readStored('guest')).toEqual([original]);
    write.mockRestore();
    await act(async () => { await view.result.current[action](value); });
    expect(view.result.current.error).toBe('');
    expect(view.result.current.ingredients).toEqual(await readStored('guest'));
  });

  it.each(['updateIngredient', 'removeIngredient'])('does not roll an old %s failure into the new account with the same row ID', async action => {
    const view = await loadedInventory();
    const pending = deferred();
    vi.spyOn(database, action === 'removeIngredient' ? 'deleteIngredient' : 'saveIngredient').mockReturnValueOnce(pending.promise);
    let outcome;
    act(() => { outcome = view.result.current[action](action === 'removeIngredient' ? original.id : { ...original, quantity: '3팩' }).catch(error => error); });
    await switchScope(view, 'user:storage-other');
    await act(async () => { pending.reject(new Error('PRIVATE old write')); await outcome; });
    expect(view.result.current.ingredients).toEqual([item('same-id', '당근')]);
    expect(view.result.current.error).toBe('');
    expect(await readStored('user:storage-other')).toEqual([item('same-id', '당근')]);
  });

  it('does not reintroduce a cleared account row when a failed write arrives after A-B-A', async () => {
    const view = await loadedInventory();
    const pending = deferred();
    vi.spyOn(database, 'saveIngredient').mockReturnValueOnce(pending.promise);
    let outcome;
    act(() => { outcome = view.result.current.updateIngredient({ ...original, quantity: '3팩' }).catch(error => error); });
    await switchScope(view, 'user:storage-other');
    await database.clearAccountLocalData('guest'); clearScopeState('guest');
    await switchScope(view, 'guest');
    await act(async () => { pending.reject(new Error('PRIVATE old write')); await outcome; });
    expect(view.result.current.ingredients).toEqual([]);
    expect(getScopeState('guest').items).toEqual([]);
    expect(view.result.current.error).toBe('');
    expect(await readStored('guest')).toEqual([]);
  });

  it('does not mark a new session dirty when an old write acknowledgement arrives', async () => {
    const view = await loadedInventory();
    const pending = deferred();
    vi.spyOn(database, 'saveIngredient').mockImplementationOnce(async (...args) => {
      // The write already committed in its original scope; delay only its ACK.
      await database.runInventoryQuantityTransaction('readwrite', stores => stores.ingredients.put(args[0]), args[1]);
      await pending.promise;
    });
    let outcome;
    act(() => { outcome = view.result.current.updateIngredient({ ...original, quantity: '3팩' }).catch(error => error); });
    await switchScope(view, 'user:storage-other');
    await act(async () => { pending.resolve(); await outcome; });
    expect(view.result.current.ingredients).toEqual([item('same-id', '당근')]);
    expect(view.result.current.syncStatus).toBe('idle');
    expect(view.result.current.hasUnsyncedChanges).toBe(false);
    expect(view.result.current.error).toBe('');
  });

  it('rejects a retained old-session mutation before it can write into any account', async () => {
    const view = await loadedInventory();
    const oldAction = view.result.current.updateIngredient;
    await switchScope(view, 'user:storage-other');
    const write = vi.spyOn(database, 'saveIngredient');
    await act(async () => { await expect(oldAction({ ...original, quantity: '3팩' })).rejects.toThrow(); });
    expect(write).not.toHaveBeenCalled();
    expect(view.result.current.ingredients).toEqual([item('same-id', '당근')]);
    expect(view.result.current.error).toBe('');
  });

  it('does not populate a new account with a late detail lookup', async () => {
    const view = await loadedInventory();
    await database.saveIngredient(item('detail-only'), 'guest');
    const pending = deferred();
    const read = database.getIngredientById;
    vi.spyOn(database, 'getIngredientById').mockImplementationOnce(async (...args) => {
      const result = await read(...args); await pending.promise; return result;
    });
    let outcome;
    act(() => { outcome = view.result.current.findIngredient('detail-only').catch(error => error); });
    await switchScope(view, 'user:storage-other');
    await act(async () => { pending.resolve(); await outcome; });
    expect(view.result.current.ingredients).toEqual([item('same-id', '당근')]);
    expect(view.result.current.error).toBe('');
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('never exposes the old account rows even in the first render of an already loaded account', async () => {
    auth.storageScope = 'user:storage-other'; auth.isAuthenticated = true;
    const observe = vi.fn();
    const view = renderInventory(observe);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await switchScope(view, 'guest');
    observe.mockClear();
    await switchScope(view, 'user:storage-other');
    const renders = observe.mock.calls.filter(([scope]) => scope === 'user:storage-other');
    expect(renders.length).toBeGreaterThan(0);
    for (const [, value] of renders) expect(value.ingredients).toEqual([item('same-id', '당근')]);
  });

  it('keeps the newer successful same-row edit when an earlier committed acknowledgement is delayed', async () => {
    const view = await loadedInventory();
    const saved = deferred(); const release = deferred();
    const write = database.saveIngredient;
    vi.spyOn(database, 'saveIngredient').mockImplementationOnce(async (...args) => {
      await write(...args); saved.resolve(); await release.promise;
    });
    let first;
    await act(async () => {
      first = view.result.current.updateIngredient({ ...original, quantity: '2팩' });
      await saved.promise;
    });
    const newer = { ...original, quantity: '3팩' };
    await act(async () => { await view.result.current.updateIngredient(newer); });
    await act(async () => { release.resolve(); await first; });
    expect(view.result.current.ingredients).toEqual([newer]);
    expect(await readStored('guest')).toEqual([newer]);
  });

  it('does not roll back a newer saved row when an older same-row write fails', async () => {
    const view = await loadedInventory();
    const pending = deferred();
    vi.spyOn(database, 'saveIngredient').mockReturnValueOnce(pending.promise);
    let first;
    act(() => { first = view.result.current.updateIngredient({ ...original, quantity: '2팩' }).catch(error => error); });
    const newer = { ...original, quantity: '3팩' };
    await act(async () => { await view.result.current.updateIngredient(newer); });
    await act(async () => { pending.reject(new Error('older failure')); await first; });
    expect(view.result.current.ingredients).toEqual([newer]);
    expect(view.result.current.error).toBe('');
    expect(await readStored('guest')).toEqual([newer]);
  });
});
