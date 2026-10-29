import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearScopeState,
  getScopeState,
  getStoredLastSyncedAt,
  setStoredLastSyncedAt
} from '../ingredientsScopeState';

describe('ingredientsScopeState privacy boundaries', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearScopeState('user:user-1');
    clearScopeState('user:user-2');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns unavailable sync metadata when the storage getter is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    expect(getStoredLastSyncedAt('guest')).toBeNull();
    expect(setStoredLastSyncedAt('guest', '2026-09-28T00:00:00.000Z')).toBe(false);
  });

  it('still discards in-memory account data and reports failed cleanup when the getter is blocked', () => {
    const previousState = getScopeState('user:user-1');
    previousState.items = [{ id: 'private-1', name: 'private ingredient' }];
    previousState.loaded = true;
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    expect(clearScopeState('user:user-1')).toBe(false);
    expect(getScopeState('user:user-1')).not.toBe(previousState);
    expect(getScopeState('user:user-1').items).toEqual([]);
    expect(getScopeState('user:user-1').loaded).toBe(false);
  });

  it('stores sync metadata per account instead of sharing a global timestamp', () => {
    window.localStorage.setItem('fridgemate-last-synced-at', 'legacy-value');

    expect(setStoredLastSyncedAt('user:user-1', '2026-08-30T01:00:00.000Z')).toBe(true);
    expect(getStoredLastSyncedAt('user:user-1')).toBe('2026-08-30T01:00:00.000Z');
    expect(getStoredLastSyncedAt('user:user-2')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-last-synced-at')).toBeNull();
  });

  it('drops both cached account state and its sync timestamp', () => {
    const previousState = getScopeState('user:user-1');
    previousState.items = [{ id: 'private-1', name: 'private ingredient' }];
    previousState.loaded = true;
    setStoredLastSyncedAt('user:user-1', '2026-08-30T01:00:00.000Z');

    expect(clearScopeState('user:user-1')).toBe(true);
    expect(getStoredLastSyncedAt('user:user-1')).toBeNull();

    const nextState = getScopeState('user:user-1');
    expect(nextState).not.toBe(previousState);
    expect(nextState.items).toEqual([]);
    expect(nextState.loaded).toBe(false);
  });
});
