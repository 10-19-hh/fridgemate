import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getUserPreferences, saveUserPreferences } from '../api/personalizationApi';
import { useAuth } from './useAuth';

const DEFAULT_PREFERENCES = {
  preferredIngredients: [],
  dislikedIngredients: [],
  spiceLevel: 'medium',
  cookingTimePreference: 'flexible'
};
const UserPreferencesContext = createContext(null);
const READ_ERROR = '이 기기의 취향 설정을 불러오지 못했어요. 저장소 접근을 확인한 뒤 다시 확인해주세요.';
const WRITE_ERROR = '이 기기에 취향 설정을 저장하지 못했어요. 이전 설정은 유지돼요. 다시 시도해주세요.';
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function normalizePreferences(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const next = { ...DEFAULT_PREFERENCES, ...value };
  if (!['preferredIngredients', 'dislikedIngredients'].every(field => Array.isArray(next[field])
    && next[field].every(item => typeof item === 'string'))
    || !['mild', 'medium', 'spicy'].includes(next.spiceLevel)
    || !['quick', 'flexible', 'leisurely'].includes(next.cookingTimePreference)) throw new Error();
  return next;
}

function key(scope) {
  return `fridgemate-user-preferences:v1:${scope}`;
}

function loadLocal(scope) {
  if (typeof window === 'undefined') return { value: DEFAULT_PREFERENCES, storageReady: true, error: '' };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key(scope)) ?? '{}');
    return { value: normalizePreferences(parsed), storageReady: true, error: '' };
  } catch {
    return { value: DEFAULT_PREFERENCES, storageReady: false, error: READ_ERROR };
  }
}

export function UserPreferencesProvider({ children }) {
  const { isAuthenticated, storageScope } = useAuth();
  const session = useMemo(() => {
    const initial = loadLocal(storageScope);
    return { scope: storageScope, authenticated: isAuthenticated, initial };
  }, [isAuthenticated, storageScope]);
  const requestRef = useRef({ session,
    ready: session.initial.storageReady, live: false, revision: 0, busy: false });
  useClientLayoutEffect(() => {
    if (requestRef.current.session !== session) requestRef.current = { session,
      ready: session.initial.storageReady, live: false, revision: 0, busy: false };
    return () => {
      requestRef.current.live = false;
      requestRef.current.revision += 1;
    };
  }, [session]);
  const [state, setState] = useState(() => ({ session, ...session.initial, saving: false, saveNotice: '' }));
  const view = useMemo(() => state.session === session ? state
    : { ...session.initial, saving: false, saveNotice: '' }, [session, state]);
  const publish = useCallback(patch => setState(previous => ({
    ...(previous.session === session ? previous : session.initial), ...patch, session
  })), [session]);
  const isCurrent = useCallback(revision => requestRef.current.session === session && requestRef.current.live
    && (revision === undefined || requestRef.current.revision === revision), [session]);

  const load = useCallback(async includeRemote => {
    if (!isCurrent() || (includeRemote && requestRef.current.busy)) return;
    const revision = ++requestRef.current.revision;
    requestRef.current.busy = false;
    const local = loadLocal(session.scope);
    requestRef.current.ready = local.storageReady;
    publish({ ...(local.storageReady ? { value: local.value } : {}),
      storageReady: local.storageReady, error: local.error, saving: false, saveNotice: '' });
    if (!local.storageReady || !includeRemote || !session.authenticated) return;
    let next;
    try {
      const remote = await getUserPreferences();
      if (!isCurrent(revision)) return;
      next = normalizePreferences(remote);
    } catch {
      if (isCurrent(revision)) publish({ error: '취향 설정을 서버에서 불러오지 못해 이 기기의 설정을 사용합니다.' });
      return;
    }
    try {
      window.localStorage.setItem(key(session.scope), JSON.stringify(next));
    } catch {
      publish({ error: '서버 설정을 불러왔지만 이 기기에 반영하지 못했어요. 이전 설정을 유지합니다. 다시 확인해주세요.' });
      return;
    }
    publish({ value: next, error: '' });
  }, [isCurrent, publish, session]);

  useEffect(() => {
    requestRef.current.live = true;
    void load(true);
    const handleStorage = event => {
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch { return; }
      if (event.key === null || event.key === key(session.scope)) void load(false);
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

  const savePreferences = useCallback(async (nextPreferences, { changedField } = {}) => {
    if (!isCurrent() || requestRef.current.busy || !requestRef.current.ready) return null;
    const savedField = changedField === 'spiceLevel' ? '매운맛'
      : changedField === 'cookingTimePreference' ? '조리 여유' : null;
    const saveNotice = savedField
      ? `${savedField} 설정을 저장했습니다. 입력한 재료는 ‘취향 저장’을 눌러 저장해주세요.`
      : '취향 설정을 저장했습니다.';
    const revision = ++requestRef.current.revision;
    requestRef.current.busy = true;
    publish({ saveNotice: '', error: '' });
    let next;
    try {
      next = normalizePreferences(nextPreferences);
      window.localStorage.setItem(key(session.scope), JSON.stringify(next));
    } catch {
      requestRef.current.busy = false;
      publish({ saving: false, error: WRITE_ERROR });
      throw new Error(WRITE_ERROR);
    }
    publish({ value: next, saving: session.authenticated });
    if (!session.authenticated) {
      requestRef.current.busy = false;
      publish({ saveNotice });
      return next;
    }
    let saved;
    try {
      saved = await saveUserPreferences(next);
    } catch {
      if (!isCurrent(revision)) return null;
      requestRef.current.busy = false;
      const message = '서버 저장에 실패했지만 이 기기의 취향 설정은 유지됩니다. 다시 저장해주세요.';
      publish({ saving: false, error: message });
      throw new Error(message);
    }
    if (!isCurrent(revision)) return null;
    requestRef.current.busy = false;
    let normalized;
    try {
      normalized = normalizePreferences(saved);
      window.localStorage.setItem(key(session.scope), JSON.stringify(normalized));
    } catch {
      // The server already acknowledged. Do not misreport the whole operation
      // as failed or replace the locally committed recommendation settings.
      publish({ saving: false, error: '서버에는 저장했지만 이 기기에 서버 응답을 반영하지 못했어요. 이 기기의 이전 저장값은 유지됩니다.' });
      return next;
    }
    publish({ value: normalized, saving: false, saveNotice });
    return normalized;
  }, [isCurrent, publish, session]);
  const reloadPreferences = useCallback(() => load(true), [load]);
  const value = useMemo(() => ({ error: view.error, preferences: view.value, saveNotice: view.saveNotice,
    storageReady: view.storageReady, saving: view.saving, scope: storageScope, savePreferences, reloadPreferences }),
  [reloadPreferences, savePreferences, storageScope, view]);
  // createElement only passes the event callbacks to the Provider; it does not
  // execute them or read their request guards during render.
  // eslint-disable-next-line react-hooks/refs
  return createElement(UserPreferencesContext.Provider, { value }, children);
}

export function useUserPreferences() {
  const context = useContext(UserPreferencesContext);
  if (!context) throw new Error('useUserPreferences must be used within UserPreferencesProvider.');
  return context;
}

export function useOptionalUserPreferences() {
  const context = useContext(UserPreferencesContext);
  return context || { preferences: DEFAULT_PREFERENCES };
}
