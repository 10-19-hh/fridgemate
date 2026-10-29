import { apiBaseUrl } from '../utils/backendConfig';
import { isLocalPilotBuild } from '../utils/pilotMode.js';
import {
  captureAuthContext, createAuthContextChangedError, invalidateAuthContext, isAuthContextCurrent, shareAuthRefresh
} from '../features/auth/authSessionContext';

export class ApiClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options.status;
    this.path = options.path;
    this.requestId = options.requestId || null;
    this.cause = options.cause;
    this.code = options.code;
  }
}

function buildHeaders(headers = {}) {
  return { ...headers };
}

async function fetchResult(path, options) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: buildHeaders(options.headers)
    });
  } catch (error) {
    return { networkError: error };
  }
  const payload = response.status === 204 ? null
    : response.ok ? await response.json() : await response.json().catch(() => ({}));
  return { response, payload };
}

function assertRequestContext(context, path, errorClass, allowVerification = false) {
  if (!isAuthContextCurrent(context) || context.transitioning || (context.blocked && !allowVerification)) {
    const error = createAuthContextChangedError();
    throw new errorClass(error.message, { path, status: error.status, code: error.code });
  }
}

export async function requestJson(
  path,
  options = {},
  { authMode = 'auto', errorClass = ApiClientError, allowNoContent = false } = {}
) {
  if (isLocalPilotBuild()) {
    throw new errorClass('Local pilot builds do not use the server.', { path, code: 'LOCAL_PILOT_ONLY' });
  }
  const origin = captureAuthContext();
  const protectedRequest = authMode === 'required';
  const refreshRequest = path === '/auth/refresh' && options.method === 'POST';
  if (protectedRequest || refreshRequest) assertRequestContext(origin, path, errorClass, refreshRequest);
  let result = await (refreshRequest
    ? shareAuthRefresh(origin, () => fetchResult(path, options))
    : fetchResult(path, options));

  if (protectedRequest || refreshRequest) assertRequestContext(origin, path, errorClass, refreshRequest);

  if (result.response?.status === 401 && protectedRequest && !options.__skipRefreshRetry && origin.userId) {
    let refreshed = false;
    let unverifiedRefresh = false;
    try {
      const refresh = await shareAuthRefresh(origin, () => fetchResult('/auth/refresh', { method: 'POST' }));
      refreshed = refresh.response?.ok === true && refresh.payload?.user?.id === origin.userId;
      unverifiedRefresh = refresh.response?.ok === true && !refreshed;
    } catch {
      // A failed or malformed refresh leaves the original authenticated error intact.
      unverifiedRefresh = true;
    }
    assertRequestContext(origin, path, errorClass);
    if (unverifiedRefresh) invalidateAuthContext();
    if (refreshed) {
      result = await fetchResult(path, options);
      assertRequestContext(origin, path, errorClass);
    }
  }

  if (result.networkError) {
    throw new errorClass('API request could not reach the server.', { path, cause: result.networkError });
  }
  const { response, payload } = result;
  if (!response.ok) {
    throw new errorClass(payload.message || 'API request failed.', {
      status: response.status,
      path,
      requestId: payload.requestId || response.headers?.get?.('x-request-id') || null
    });
  }

  if (response.status === 204) {
    return allowNoContent ? null : {};
  }

  return payload;
}
