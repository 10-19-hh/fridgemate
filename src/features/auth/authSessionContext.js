// Only browser-local request ownership, not proof of the server cookie identity.
export const AUTH_CHANGE_KEY = 'fridgemate-auth-change:v1';
export const AUTH_CONTEXT_INVALIDATED_EVENT = 'fridgemate-auth-context-invalidated';
let userId = null;
let generation = 0;
let inFlightRefresh = null;
let transitioning = false;
let blocked = false;
let verifying = false;
let changeToken = readChangeToken();

function readChangeToken() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(AUTH_CHANGE_KEY);
  } catch {
    return null;
  }
}

export function captureAuthContext() {
  return { userId, generation, changeToken, transitioning, blocked };
}

export function isAuthContextCurrent(context) {
  return context.userId === userId && context.generation === generation &&
    context.changeToken === changeToken && changeToken === readChangeToken();
}

export function updateAuthIdentity(nextUserId) {
  const next = typeof nextUserId === 'string' && nextUserId ? nextUserId : null;
  if (next !== userId) {
    userId = next;
    generation += 1;
  }
  blocked = next === null;
  verifying = false;
  changeToken = readChangeToken();
  return captureAuthContext();
}

export function beginAuthChange({ broadcast = true } = {}) {
  generation += 1;
  transitioning = broadcast;
  blocked = false;
  verifying = false;
  if (broadcast) {
    try {
      window.localStorage.setItem(AUTH_CHANGE_KEY, globalThis.crypto.randomUUID());
    } catch {
      // Memory still fences this tab when storage is blocked. Cross-tab delivery is not guaranteed.
    }
  }
  changeToken = readChangeToken();
  return captureAuthContext();
}

export function invalidateAuthContext() {
  beginAuthChange({ broadcast: false });
  updateAuthIdentity(null);
  blocked = true;
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(AUTH_CONTEXT_INVALIDATED_EVENT));
  }
}

export function beginAuthVerification() {
  if (!transitioning && ((blocked && !verifying) || !isAuthContextCurrent(captureAuthContext()))) {
    generation += 1;
    userId = null;
    blocked = true;
    verifying = true;
    changeToken = readChangeToken();
  }
  return captureAuthContext();
}

export function assertAuthActionOwner(context) {
  if (!isAuthContextCurrent(context)) throw createAuthContextChangedError();
}

export function finishAuthChange(context) {
  if (isAuthContextCurrent(context) && transitioning) {
    transitioning = false;
    generation += 1;
  }
}

export function createAuthContextChangedError() {
  return Object.assign(new Error('계정 상태가 바뀌어 이전 요청을 중단했습니다. 현재 계정에서 다시 시도해주세요.'), {
    status: 401, code: 'AUTH_CONTEXT_CHANGED'
  });
}

export function shareAuthRefresh(context, execute) {
  if (inFlightRefresh && isAuthContextCurrent(inFlightRefresh.context)) return inFlightRefresh.promise;
  const entry = { context, promise: null };
  entry.promise = execute().finally(() => {
    if (inFlightRefresh === entry) inFlightRefresh = null;
  });
  inFlightRefresh = entry;
  return entry.promise;
}
