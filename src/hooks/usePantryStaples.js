import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PANTRY_STATUS, PANTRY_STATUS_ORDER, pantryStaples } from '../data/pantryStaples';
import { getPantryOwnership, savePantryOwnership } from '../api/personalizationApi';
import { useAuth } from './useAuth';

const LEGACY_STORAGE_KEY = 'fridgemate-pantry-ownership';
const PantryStaplesContext = createContext(null);
const READ_ERROR = '이 기기의 팬트리 설정을 불러오지 못했어요. 저장소 접근을 확인한 뒤 다시 확인해주세요.';
const WRITE_ERROR = '이 기기에 팬트리 설정을 저장하지 못했어요. 이전 설정은 유지돼요. 다시 시도해주세요.';
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function validOwnership(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(status => Object.values(PANTRY_STATUS).includes(status));
}

function storageKey(scope) {
  return `fridgemate-pantry-ownership:v2:${scope}`;
}

function getInitialPantryOwnership(scope = 'guest') {
  if (typeof window === 'undefined') {
    return { value: {}, storageReady: true, error: '' };
  }

  try {
    const scopedValue = window.localStorage.getItem(storageKey(scope));
    const legacyValue = scopedValue === null && scope === 'guest' ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const parsed = JSON.parse(scopedValue ?? legacyValue ?? '{}');
    if (!validOwnership(parsed)) throw new Error();
    return { value: parsed, storageReady: true, error: '' };
  } catch {
    return { value: {}, storageReady: false, error: READ_ERROR };
  }
}

function getNextStatus(currentStatus) {
  const currentIndex = PANTRY_STATUS_ORDER.indexOf(currentStatus);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % PANTRY_STATUS_ORDER.length;
  return PANTRY_STATUS_ORDER[nextIndex];
}

export function PantryStaplesProvider({ children }) {
  const { isAuthenticated, storageScope } = useAuth();
  // A new object also distinguishes A → B → A. Late requests must not revive
  // a cleared account cache, even when the final scope string is the same.
  const session = useMemo(() => {
    const initial = getInitialPantryOwnership(storageScope);
    return { scope: storageScope, authenticated: isAuthenticated, initial };
  }, [isAuthenticated, storageScope]);
  const requestRef = useRef({ session, current: session.initial.value,
    ready: session.initial.storageReady, live: false, revision: 0, busy: false, retry: null });
  useClientLayoutEffect(() => {
    // Invalidate the old scope before async callbacks can run after a commit.
    if (requestRef.current.session !== session) requestRef.current = { session, current: session.initial.value,
      ready: session.initial.storageReady, live: false, revision: 0, busy: false, retry: null };
    return () => {
      requestRef.current.live = false;
      requestRef.current.revision += 1;
    };
  }, [session]);
  const [state, setState] = useState(() => ({ session, ...session.initial, saving: false, canRetrySave: false }));
  const view = useMemo(() => state.session === session ? state
    : { ...session.initial, saving: false, canRetrySave: false }, [session, state]);
  const pantryOwnership = view.value;
  const publish = useCallback(patch => setState(previous => ({
    ...(previous.session === session ? previous : session.initial), ...patch, session
  })), [session]);
  const isCurrent = useCallback(revision => requestRef.current.session === session && requestRef.current.live
    && (revision === undefined || requestRef.current.revision === revision), [session]);

  const load = useCallback(async (includeRemote) => {
    if (!isCurrent() || (includeRemote && requestRef.current.busy)) return;
    const revision = ++requestRef.current.revision;
    requestRef.current.busy = false;
    requestRef.current.retry = null;
    const local = getInitialPantryOwnership(session.scope);
    requestRef.current.ready = local.storageReady;
    if (local.storageReady) requestRef.current.current = local.value;
    publish({ ...local, value: requestRef.current.current, saving: false, canRetrySave: false });
    if (!local.storageReady || !includeRemote || !session.authenticated) return;
    let merged;
    try {
      const items = await getPantryOwnership();
      if (!isCurrent(revision)) return;
      if (!Array.isArray(items)) throw new Error();
      merged = { ...local.value, ...Object.fromEntries(items.map(item => [item.stapleId, item.status])) };
      if (!validOwnership(merged)) throw new Error();
    } catch {
      if (isCurrent(revision)) publish({ error: '팬트리 서버 상태를 불러오지 못해 이 기기의 설정을 사용합니다.' });
      return;
    }
    try {
      window.localStorage.setItem(storageKey(session.scope), JSON.stringify(merged));
    } catch {
      publish({ error: '서버 설정을 불러왔지만 이 기기에 반영하지 못했어요. 이전 설정을 유지합니다. 다시 확인해주세요.' });
      return;
    }
    requestRef.current.current = merged;
    publish({ value: merged, error: '' });
  }, [isCurrent, publish, session]);

  useEffect(() => {
    requestRef.current.live = true;
    void load(true);
    const handleStorage = event => {
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch { return; }
      if (event.key === null || event.key === storageKey(session.scope)
        || (session.scope === 'guest' && event.key === LEGACY_STORAGE_KEY)) void load(false);
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      if (requestRef.current.session === session) {
        requestRef.current.live = false;
        requestRef.current.revision += 1;
      }
      window.removeEventListener('storage', handleStorage);
    };
  }, [load, session]);

  const setPantryStatus = useCallback(async (id, status) => {
    if (!isCurrent() || requestRef.current.busy || !requestRef.current.ready) return false;
    const nextStatus = Object.values(PANTRY_STATUS).includes(status) ? status : PANTRY_STATUS.UNKNOWN;
    const next = { ...requestRef.current.current, [id]: nextStatus };
    const revision = ++requestRef.current.revision;
    requestRef.current.busy = true;
    requestRef.current.retry = { id, status: nextStatus };
    try {
      // Local persistence is the commit boundary for recommendation state.
      // Never run I/O from a React state updater (StrictMode may replay it).
      window.localStorage.setItem(storageKey(session.scope), JSON.stringify(next));
    } catch {
      requestRef.current.busy = false;
      publish({ error: WRITE_ERROR, saving: false, canRetrySave: true });
      return false;
    }
    requestRef.current.current = next;
    publish({ value: next, error: '', saving: session.authenticated, canRetrySave: false });
    if (session.authenticated) {
      try {
        await savePantryOwnership([{ stapleId: id, status: nextStatus }]);
      } catch {
        if (isCurrent(revision)) {
          requestRef.current.busy = false;
          publish({ saving: false, canRetrySave: true, error: '서버 저장에 실패했지만 이 기기의 팬트리 설정은 유지됩니다. 다시 저장해주세요.' });
        }
        return false;
      }
    }
    if (!isCurrent(revision)) return false;
    requestRef.current.busy = false;
    requestRef.current.retry = null;
    publish({ saving: false, canRetrySave: false, error: '' });
    return true;
  }, [isCurrent, publish, session]);
  const cyclePantryStatus = useCallback(id => setPantryStatus(id,
    getNextStatus(requestRef.current.current[id] || PANTRY_STATUS.UNKNOWN)), [setPantryStatus]);
  const retryPantrySave = useCallback(() => requestRef.current.retry
    ? setPantryStatus(requestRef.current.retry.id, requestRef.current.retry.status) : Promise.resolve(false), [setPantryStatus]);
  const reloadPantryOwnership = useCallback(() => load(true), [load]);

  const pantrySummary = useMemo(() => {
    const summary = {
      owned: 0,
      missing: 0,
      unknown: 0
    };

    pantryStaples.forEach((staple) => {
      const status = pantryOwnership[staple.id] || PANTRY_STATUS.UNKNOWN;
      summary[status] += 1;
    });

    return summary;
  }, [pantryOwnership]);

  const value = useMemo(
    () => ({
      pantryStaples,
      pantryOwnership,
      pantrySummary,
      syncError: view.error,
      saving: view.saving,
      storageReady: view.storageReady,
      canRetrySave: view.canRetrySave,
      retryPantrySave,
      reloadPantryOwnership,
      setPantryStatus,
      cyclePantryStatus
    }),
    [cyclePantryStatus, pantryOwnership, pantrySummary, setPantryStatus, view, retryPantrySave, reloadPantryOwnership]
  );

  return createElement(PantryStaplesContext.Provider, { value }, children);
}

export function usePantryStaples() {
  const context = useContext(PantryStaplesContext);

  if (!context) {
    throw new Error('usePantryStaples must be used within PantryStaplesProvider.');
  }

  return context;
}
