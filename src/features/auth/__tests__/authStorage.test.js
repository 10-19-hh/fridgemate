import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildUserStorageScope,
  clearAccountFeatureStorage,
  clearGuestImportDecision,
  clearPendingLogout,
  clearSessionHint,
  clearStoredAuthSession,
  getGuestImportDecision,
  GUEST_STORAGE_SCOPE,
  hasPendingLogout,
  hasSessionHint,
  markLogoutPending,
  markSessionPresent,
  setGuestImportDecision
} from '../authStorage.js';

describe('authStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it.each([
    ['session hint', hasSessionHint, false],
    ['pending logout', hasPendingLogout, false],
    ['guest import decision', () => getGuestImportDecision('user-1'), ''],
    ['mark session present', markSessionPresent, false],
    ['mark logout pending', markLogoutPending, false],
    ['clear legacy session', clearStoredAuthSession, false],
    ['clear session hint', clearSessionHint, false],
    ['clear logout fence', clearPendingLogout, false],
    ['clear guest import decision', () => clearGuestImportDecision('user-1'), false],
    ['clear account features', () => clearAccountFeatureStorage('user-1'), false],
    ['set guest import decision', () => setGuestImportDecision('user-1', 'dismissed'), undefined]
  ])('handles a blocked storage getter for %s without reporting a successful write or cleanup', (_name, operation, expected) => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    expect(operation()).toBe(expected);
  });

  it('removes the legacy persisted server session', () => {
    window.localStorage.setItem(
      'fridgemate-auth-session',
      JSON.stringify({ user: { id: 'user-1', email: 'hello@example.com' } })
    );

    clearStoredAuthSession();

    expect(window.localStorage.getItem('fridgemate-auth-session')).toBeNull();
  });

  it('stores only a versioned non-PII logout fence', () => {
    expect(markLogoutPending()).toBe(true);
    expect(hasPendingLogout()).toBe(true);
    expect(window.localStorage.getItem('fridgemate-auth-logout-pending:v1')).toBe('1');

    clearPendingLogout();

    expect(hasPendingLogout()).toBe(false);
  });

  it('stores only a versioned non-PII session hint', () => {
    expect(markSessionPresent()).toBe(true);
    expect(hasSessionHint()).toBe(true);
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBe('1');

    clearSessionHint();

    expect(hasSessionHint()).toBe(false);
  });

  it('treats a legacy session as a one-time refresh hint without parsing its identity', () => {
    window.localStorage.setItem('fridgemate-auth-session', '{not-valid-json');

    expect(hasSessionHint()).toBe(true);
  });

  it('tracks guest import decisions per user', () => {
    setGuestImportDecision('user-1', 'dismissed');

    expect(getGuestImportDecision('user-1')).toBe('dismissed');
    expect(getGuestImportDecision('user-2')).toBe('');
  });

  it('builds clear storage scopes', () => {
    expect(buildUserStorageScope('user-1')).toBe('user:user-1');
    expect(GUEST_STORAGE_SCOPE).toBe('guest');
  });

  it('clears only the deleted account feature keys', () => {
    window.localStorage.setItem('fridgemate-pantry-ownership:v2:user:user-1', '{}');
    window.localStorage.setItem('fridgemate-user-preferences:v1:user:user-1', '{}');
    window.localStorage.setItem('fridgemate-dismissed-recipes:v1:user:user-1:2026-08-30', '[]');
    window.localStorage.setItem('fridgemate-pantry-ownership:v2:user:user-2', '{"keep":true}');
    window.localStorage.setItem('unrelated', 'keep');

    expect(clearAccountFeatureStorage('user-1')).toBe(true);
    expect(window.localStorage.getItem('fridgemate-pantry-ownership:v2:user:user-1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-user-preferences:v1:user:user-1')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-dismissed-recipes:v1:user:user-1:2026-08-30')).toBeNull();
    expect(window.localStorage.getItem('fridgemate-pantry-ownership:v2:user:user-2')).toBe('{"keep":true}');
    expect(window.localStorage.getItem('unrelated')).toBe('keep');
  });
});
