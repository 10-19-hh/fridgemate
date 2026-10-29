import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = {
  getAllIngredients: vi.fn(),
  replaceIngredients: vi.fn()
};

vi.mock('../../../db/indexedDB.js', () => ({
  getAllIngredients: (...args) => dbMocks.getAllIngredients(...args),
  replaceIngredients: (...args) => dbMocks.replaceIngredients(...args)
}));

describe('guestImportService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
    dbMocks.getAllIngredients.mockResolvedValue([]);
    dbMocks.replaceIngredients.mockResolvedValue(undefined);
  });

  it('shows a prompt when guest ingredients exist and there is no prior decision', async () => {
    dbMocks.getAllIngredients.mockResolvedValue([{ id: 'guest-1', name: 'kimchi' }]);
    const { inspectGuestImportPrompt } = await import('../guestImportService.js');
    const setGuestImportPrompt = vi.fn();

    await inspectGuestImportPrompt({
      isAuthenticated: true,
      user: { id: 'user-1' },
      setGuestImportPrompt,
      defaultGuestImportPrompt: { available: false, count: 0, loading: false }
    });

    expect(setGuestImportPrompt).toHaveBeenCalledWith({
      available: true,
      count: 1,
      loading: false
    });
  });

  it('imports guest ingredients into the authenticated local scope without uploading them', async () => {
    dbMocks.getAllIngredients.mockResolvedValue([
      { id: 'guest-1', name: 'kimchi', syncState: 'pending', lastSyncedAt: 'now' }
    ]);

    const { importGuestIngredientsForUser } = await import('../guestImportService.js');
    const setGuestImportPrompt = vi.fn();
    const setError = vi.fn();

    const result = await importGuestIngredientsForUser({
      backendEnabled: true,
      user: { id: 'user-1' },
      setGuestImportPrompt,
      setError,
      defaultGuestImportPrompt: { available: false, count: 0, loading: false }
    });

    expect(result).toEqual([{ id: 'guest-1', name: 'kimchi' }]);
    expect(dbMocks.replaceIngredients).toHaveBeenCalledWith([{ id: 'guest-1', name: 'kimchi' }], {
      scope: 'user:user-1'
    });
    expect(setError).toHaveBeenCalledWith('');
  });

  it.each(['read-success', 'read-failure', 'replace-success', 'replace-failure'])(
    'ignores an old account import after scope changes while waiting for %s', async (phase) => {
      let resolve;
      let reject;
      const gate = new Promise((done, fail) => { resolve = done; reject = fail; });
      const { persistSession } = await import('../authSessionService.js');
      const { importGuestIngredientsForUser } = await import('../guestImportService.js');
      persistSession({ user: { id: 'A' } }, () => {});
      const options = { backendEnabled: true, user: { id: 'A' }, setGuestImportPrompt: vi.fn(), setError: vi.fn(),
        defaultGuestImportPrompt: { available: false, count: 0, loading: false } };
      if (phase.startsWith('read')) dbMocks.getAllIngredients.mockReturnValue(gate);
      else {
        dbMocks.getAllIngredients.mockResolvedValue([{ id: 'guest-1', name: 'kimchi' }]);
        dbMocks.replaceIngredients.mockReturnValue(gate);
      }
      const pending = importGuestIngredientsForUser(options).catch(error => error);
      if (phase.startsWith('replace')) await vi.waitFor(() => expect(dbMocks.replaceIngredients).toHaveBeenCalledTimes(1));
      persistSession(null, () => {});
      persistSession({ user: { id: 'B' } }, () => {});
      options.setGuestImportPrompt.mockClear();
      options.setError.mockClear();
      if (phase.endsWith('failure')) reject(new Error('old operation failed'));
      else resolve([{ id: 'guest-1', name: 'kimchi' }]);
      expect(await pending).toMatchObject({ code: 'AUTH_CONTEXT_CHANGED' });
      if (phase.startsWith('read')) expect(dbMocks.replaceIngredients).not.toHaveBeenCalled();
      expect(window.localStorage.getItem('fridgemate-guest-import:A')).toBeNull();
      expect(options.setGuestImportPrompt).not.toHaveBeenCalled();
      expect(options.setError).not.toHaveBeenCalled();
    }
  );
});
