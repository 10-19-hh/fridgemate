import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the provider, session service, API client, privacy UI and protected route real.
// Unrelated account panels are outside these request-ownership integration checks.
vi.mock('../../utils/backendConfig', () => ({
  apiBaseUrl: 'https://privacy-fixture.invalid/api', isBackendEnabled: () => true,
}));
vi.mock('../../hooks/useIngredients', () => ({ useIngredients: () => ({ syncStatus: 'idle' }) }));
vi.mock('../../hooks/useMenuDecision', () => ({ useMenuDecision: () => ({ guestDecisionAvailable: false }) }));
vi.mock('../../components/PreferenceSettingsPanel', () => ({ default: () => null }));

const SESSION = { user: { id: 'privacy-user', email: 'privacy@example.com', createdAt: '2026-01-01T00:00:00.000Z' } };
const CREDENTIALS = { email: 'privacy@example.com', password: 'fixture-login-password!' };
const EXPORT = { schemaVersion: 2, generatedAt: '2026-09-28T00:00:00.000Z', account: SESSION.user,
  ingredients: [], importCorrections: [], recommendationEvents: [], menuDecisions: [],
  pantryOwnerships: [], preference: null, productEvents: [] };
const deferreds = [];
let fetchMock;
let exportRequest;
let deletionRequest;
let createObjectURL;
let revokeObjectURL;
let downloads;

function response(status, payload) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(), json: async () => payload };
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const result = { promise, resolve, reject }; deferreds.push(result);
  return result;
}
function requestsFor(pathname) {
  return fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === `/api${pathname}`);
}
const exportInput = () => screen.getByLabelText('내려받기 전 현재 비밀번호 확인');
const exportButton = () => screen.getByRole('button', { name: '내 데이터 내려받기', exact: true });
function submitExport(password = 'fixture-export-password') {
  fireEvent.change(exportInput(), { target: { value: password } });
  fireEvent.submit(exportButton().closest('form'));
}
function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(JSON.parse(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
  window.localStorage.setItem('fridgemate-auth-session-present:v1', '1');
  exportRequest = vi.fn(() => { throw new Error('Unexpected export request'); });
  deletionRequest = vi.fn(() => { throw new Error('Unexpected account deletion'); });
  fetchMock = vi.fn((url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/auth/refresh' && options.method === 'POST') return response(200, SESSION);
    if (path === '/api/auth/login' && options.method === 'POST') return response(200, SESSION);
    if (path === '/api/auth/logout' && options.method === 'POST') return response(204, null);
    if (path === '/api/auth/data-export' && options.method === 'POST') return exportRequest();
    if (path === '/api/auth/account' && options.method === 'DELETE') return deletionRequest();
    throw new Error(`Unexpected fixture request: ${options.method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  createObjectURL = vi.fn(() => 'blob:privacy-integration');
  revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloads.push({ href: this.href, filename: this.download, connected: this.isConnected });
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => { deferreds.splice(0).forEach(item => item.resolve(response(200, EXPORT))); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function openAccount() {
  const [{ default: AccountPage }, { default: ProtectedRoute }, { AuthProvider, useAuth }] = await Promise.all([
    import('../AccountPage'), import('../../components/auth/ProtectedRoute'), import('../../hooks/useAuth'),
  ]);
  function LoginDestination() {
    const { login, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    return <><h1>인증이 필요한 화면</h1><p>{isAuthenticated ? '현재 로그인 상태' : '현재 게스트 상태'}</p>
      <button type="button" onClick={async () => { await login(CREDENTIALS); navigate('/account'); }}>
        같은 계정으로 다시 로그인
      </button></>;
  }
  render(<StrictMode><MemoryRouter initialEntries={['/account']}><AuthProvider>
    <Routes>
      <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
      <Route path="/login" element={<LoginDestination />} />
    </Routes>
  </AuthProvider></MemoryRouter></StrictMode>);
  await screen.findByLabelText('내려받기 전 현재 비밀번호 확인');
  expect(screen.getByRole('heading', { name: 'privacy@example.com' })).toBeInTheDocument();
}

describe('privacy actions through the real auth provider and API client', () => {
  // A missing download, changed password argument, or premature password reset breaks this contract.
  it('downloads only the acknowledged export and clears its password in StrictMode', async () => {
    const pending = deferred(); exportRequest.mockReturnValue(pending.promise);
    await openAccount();
    submitExport();
    expect(exportInput()).toHaveValue('fixture-export-password');
    expect(exportButton()).toBeDisabled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(requestsFor('/auth/data-export')).toHaveLength(1);
    expect(requestsFor('/auth/data-export')[0][1]).toMatchObject({
      method: 'POST', credentials: 'include', body: '{"password":"fixture-export-password"}',
    });
    await act(async () => pending.resolve(response(200, EXPORT)));
    expect(screen.getByText('내 데이터 파일을 내려받았습니다.')).toBeInTheDocument();
    expect(exportInput()).toHaveValue('');
    expect(exportButton()).toBeEnabled();
    expect(downloads).toEqual([{ href: 'blob:privacy-integration', filename: expect.stringMatching(/^fridgemate-data-\d{4}-\d{2}-\d{2}\.json$/), connected: true }]);
    expect(await readBlob(createObjectURL.mock.calls[0][0])).toEqual(EXPORT);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:privacy-integration');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  // Swallowing the API error or leaving the pending lock set prevents a real explicit retry.
  it('retains the password after API failure and completes an explicit retry', async () => {
    const retry = deferred();
    exportRequest.mockReturnValueOnce(response(503, { message: '잠시 후 다시 시도해주세요.' })).mockReturnValueOnce(retry.promise);
    await openAccount();
    submitExport('retry-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('잠시 후 다시 시도해주세요.');
    expect(exportInput()).toHaveValue('retry-password');
    expect(exportButton()).toBeEnabled();
    expect(downloads).toEqual([]);
    fireEvent.submit(exportButton().closest('form'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    expect(requestsFor('/auth/data-export').map(([, options]) => options.body)).toEqual([
      '{"password":"retry-password"}', '{"password":"retry-password"}',
    ]);
    await act(async () => retry.resolve(response(200, EXPORT)));
    expect(screen.getByText('내 데이터 파일을 내려받았습니다.')).toBeInTheDocument();
    expect(exportInput()).toHaveValue('');
    expect(downloads).toHaveLength(1);
  });

  // Removing ownership checks would let an old same-account session download or unlock a new request.
  it('clears drafts on same-account relogin and ignores the previous session export', async () => {
    const previous = deferred(); const current = deferred();
    exportRequest.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    await openAccount();
    fireEvent.click(screen.getByRole('button', { name: '계정 삭제', exact: true }));
    fireEvent.change(screen.getByLabelText('현재 비밀번호', { exact: true }), { target: { value: 'previous-delete-password' } });
    submitExport('previous-export-password');
    fireEvent.click(screen.getByRole('button', { name: '로그아웃', exact: true }));
    await screen.findByRole('heading', { name: '인증이 필요한 화면' });
    expect(screen.getByText('현재 게스트 상태')).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem('fridgemate-auth-logout-pending:v1')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '같은 계정으로 다시 로그인' }));
    await screen.findByLabelText('내려받기 전 현재 비밀번호 확인');
    expect(exportInput()).toHaveValue('');
    expect(screen.queryByRole('button', { name: '영구 삭제 확인' })).not.toBeInTheDocument();
    expect(requestsFor('/auth/login')[0][1].body).toBe('{"email":"privacy@example.com","password":"fixture-login-password!"}');
    submitExport('current-export-password');
    await act(async () => previous.resolve(response(200, EXPORT)));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(exportInput()).toHaveValue('current-export-password');
    expect(exportButton()).toBeDisabled();
    const currentExport = { ...EXPORT, generatedAt: '2026-09-28T01:00:00.000Z' };
    await act(async () => current.resolve(response(200, currentExport)));
    expect(downloads).toHaveLength(1);
    expect(await readBlob(createObjectURL.mock.calls[0][0])).toEqual(currentExport);
    expect(exportInput()).toHaveValue('');
  });

  // Merely resolving DELETE is insufficient: the real service must clear auth and leave the protected page.
  it('leaves the protected account route only after acknowledged deletion and local cleanup', async () => {
    const pending = deferred(); deletionRequest.mockReturnValue(pending.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAccount();
    fireEvent.click(screen.getByRole('button', { name: '계정 삭제', exact: true }));
    fireEvent.change(screen.getByLabelText('현재 비밀번호', { exact: true }), { target: { value: 'fixture-delete-password' } });
    fireEvent.submit(screen.getByRole('button', { name: '영구 삭제 확인' }).closest('form'));
    expect(screen.getByText('계정과 데이터를 삭제하고 있습니다...')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '인증이 필요한 화면' })).not.toBeInTheDocument();
    expect(requestsFor('/auth/account')).toHaveLength(1);
    expect(requestsFor('/auth/account')[0][1]).toMatchObject({
      method: 'DELETE', credentials: 'include', body: '{"password":"fixture-delete-password"}',
    });
    await act(async () => pending.resolve(response(204, null)));
    await screen.findByRole('heading', { name: '인증이 필요한 화면' });
    expect(screen.getByText('현재 게스트 상태')).toBeInTheDocument();
    expect(screen.queryByLabelText('내려받기 전 현재 비밀번호 확인')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('fridgemate-auth-session-present:v1')).toBeNull();
    expect(downloads).toEqual([]);
  });
});
