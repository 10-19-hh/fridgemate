import * as indexedDb from '../../db/indexedDB';
import {
  buildUserStorageScope,
  getGuestImportDecision,
  GUEST_STORAGE_SCOPE,
  setGuestImportDecision
} from './authStorage';
import { createUnavailableAuthError } from './authSessionService';
import {
  assertAuthActionOwner, captureAuthContext, createAuthContextChangedError, isAuthContextCurrent
} from './authSessionContext';

export async function inspectGuestImportPrompt({ isAuthenticated, user, setGuestImportPrompt, defaultGuestImportPrompt }) {
  if (!isAuthenticated) {
    setGuestImportPrompt(defaultGuestImportPrompt);
    return;
  }

  const decision = getGuestImportDecision(user.id);

  if (decision) {
    setGuestImportPrompt(defaultGuestImportPrompt);
    return;
  }

  const guestIngredients = await indexedDb.getAllIngredients({ scope: GUEST_STORAGE_SCOPE });
  setGuestImportPrompt({
    available: guestIngredients.length > 0,
    count: guestIngredients.length,
    loading: false
  });
}

export async function importGuestIngredientsForUser({
  backendEnabled,
  user,
  setGuestImportPrompt,
  setError,
  ownerContext = captureAuthContext(),
  defaultGuestImportPrompt
}) {
  assertAuthActionOwner(ownerContext);
  if (!backendEnabled || !user?.id) {
    throw createUnavailableAuthError();
  }

  setGuestImportPrompt((current) => ({
    ...current,
    loading: true
  }));
  setError('');

  try {
    const guestIngredients = await indexedDb.getAllIngredients({ scope: GUEST_STORAGE_SCOPE });
    assertAuthActionOwner(ownerContext);

    if (!guestIngredients.length) {
      setGuestImportDecision(user.id, 'imported');
      setGuestImportPrompt(defaultGuestImportPrompt);
      return [];
    }

    const importedIngredients = guestIngredients.map(({ lastSyncedAt, syncState, ...ingredient }) => ingredient);

    await indexedDb.replaceIngredients(importedIngredients, { scope: buildUserStorageScope(user.id) });
    assertAuthActionOwner(ownerContext);

    setGuestImportDecision(user.id, 'imported');
    setGuestImportPrompt(defaultGuestImportPrompt);
    return importedIngredients;
  } catch (nextError) {
    if (!isAuthContextCurrent(ownerContext)) throw createAuthContextChangedError();
    setError(nextError.message || 'Guest ingredients could not be imported.');
    throw nextError;
  } finally {
    if (isAuthContextCurrent(ownerContext)) {
      setGuestImportPrompt((current) => ({
        ...current,
        loading: false
      }));
    }
  }
}

export function dismissGuestImportPrompt({ user, setGuestImportPrompt, defaultGuestImportPrompt, ownerContext = captureAuthContext() }) {
  assertAuthActionOwner(ownerContext);
  if (!user?.id) {
    return;
  }

  setGuestImportDecision(user.id, 'dismissed');
  setGuestImportPrompt(defaultGuestImportPrompt);
}
