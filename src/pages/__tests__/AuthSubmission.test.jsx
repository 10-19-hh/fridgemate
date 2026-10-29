import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { BrowserRouter, Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  backendEnabled: true, publicSignupEnabled: true, trackEvent: vi.fn(),
  login: vi.fn(), signup: vi.fn(), refreshSession: vi.fn(), logout: vi.fn(), deleteAccount: vi.fn(),
}));
vi.mock('../../api/authApi', () => ({
  login: (...args) => boundary.login(...args), signup: (...args) => boundary.signup(...args),
  refreshSession: (...args) => boundary.refreshSession(...args), logout: (...args) => boundary.logout(...args),
  deleteAccount: (...args) => boundary.deleteAccount(...args),
}));
vi.mock('../../hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackEvent: boundary.trackEvent }) }));
vi.mock('../../utils/backendConfig', () => ({
  isBackendEnabled: () => boundary.backendEnabled,
  isPublicSignupEnabled: () => boundary.publicSignupEnabled,
}));

const SESSION = { user: { id: 'submission-user', email: 'learner@example.com' } };
const CREDENTIALS = { email: 'learner@example.com', password: 'not-a-real-password!' };
const ORIGINAL_URL = window.location.href;
const ORIGINAL_HISTORY_STATE = window.history.state;
const deferreds = [];
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const result = { promise, resolve, reject }; deferreds.push(result);
  return result;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  boundary.backendEnabled = true;
  boundary.publicSignupEnabled = true;
  window.localStorage.clear();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() });
});
afterEach(async () => {
  cleanup();
  // Settle even when an assertion failed so one case cannot leak pending work.
  await act(async () => { deferreds.splice(0).forEach(item => item.resolve(SESSION)); });
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(ORIGINAL_HISTORY_STATE, '', ORIGINAL_URL);
});

async function openPage(operation, { restoring = false, browser = false } = {}) {
  if (restoring) window.localStorage.setItem('fridgemate-auth-session-present:v1', '1');
  const [{ default: LoginPage }, { default: SignupPage }, { AuthProvider, useAuth }] = await Promise.all([
    import('../LoginPage'), import('../SignupPage'), import('../../hooks/useAuth'),
  ]);
  function Destination({ title }) {
    const { isAuthenticated } = useAuth();
    return <><h1>{title}</h1><p>{isAuthenticated ? '로그인 상태' : '게스트 상태'}</p></>;
  }
  const Router = browser ? BrowserRouter : MemoryRouter;
  if (browser) window.history.replaceState({ key: 'browser-start' }, '', `/${operation}`);
  render(<StrictMode><Router {...(browser ? {} : { initialEntries: [{ pathname: `/${operation}`, state: { from: { pathname: '/recipes' } } }] })}>
    <AuthProvider>
      <Link to="/other">다른 작업으로 이동</Link>
      <Link to={`/${operation}`}>같은 화면 새로 열기</Link>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/account" element={<Destination title="계정 화면" />} />
        <Route path="/recipes" element={<Destination title="메뉴 화면" />} />
        <Route path="/other" element={<Destination title="다른 작업" />} />
      </Routes>
    </AuthProvider>
  </Router></StrictMode>);
  const email = screen.getByLabelText('이메일');
  const password = screen.getByLabelText(/^비밀번호/);
  fireEvent.change(email, { target: { value: CREDENTIALS.email } });
  fireEvent.change(password, { target: { value: CREDENTIALS.password } });
  return { form: email.closest('form'), email, password };
}

describe.each([
  ['login', '로그인', '메뉴 화면', 'login_completed'],
  ['signup', '회원가입', '계정 화면', 'signup_completed'],
])('%s submission ownership', (operation, buttonName, destination, eventName) => {
  it('sends one request for same-tick submissions and keeps normal provider success feedback and destination', async () => {
    const pending = deferred(); boundary[operation].mockReturnValue(pending.promise);
    const { form } = await openPage(operation);
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(boundary[operation]).toHaveBeenCalledTimes(1);
    expect(boundary[operation]).toHaveBeenCalledWith(CREDENTIALS);
    expect(form.querySelector('button[type="submit"]')).toBeDisabled();
    await act(async () => pending.resolve(SESSION));
    expect(await screen.findByRole('heading', { name: destination })).toBeInTheDocument();
    expect(screen.getByText('로그인 상태')).toBeInTheDocument();
    expect(boundary.trackEvent).toHaveBeenCalledTimes(1);
    expect(boundary.trackEvent).toHaveBeenCalledWith(eventName, operation === 'login'
      ? { restored_session: false, source_screen: 'login' } : { source_screen: 'signup' });
  });

  it('does not dispatch a form submission while the initial session check is pending', async () => {
    const restoring = deferred(); boundary.refreshSession.mockReturnValue(restoring.promise);
    const request = deferred(); boundary[operation].mockReturnValue(request.promise);
    const { form } = await openPage(operation, { restoring: true });
    expect(form.querySelector('button[type="submit"]')).toBeDisabled();
    fireEvent.submit(form);
    expect(boundary[operation]).not.toHaveBeenCalled();
    expect(boundary.trackEvent).not.toHaveBeenCalled();
    await act(async () => restoring.reject(new Error('세션 확인 실패')));
    expect(screen.getByRole('button', { name: buttonName, exact: true })).toBeEnabled();
  });

  it('does not begin submission or show a new request error in local-only mode', async () => {
    boundary.backendEnabled = false;
    const { form, email, password } = await openPage(operation);
    fireEvent.submit(form);
    await act(async () => {});
    expect(boundary[operation]).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: buttonName, exact: true })).toBeDisabled();
    expect(email).toHaveValue(CREDENTIALS.email);
    expect(password).toHaveValue(CREDENTIALS.password);
  });

  it('preserves credentials after failure and releases the submit lock for an explicit retry', async () => {
    const first = deferred(); const second = deferred();
    boundary[operation].mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { form, email, password } = await openPage(operation);
    fireEvent.submit(form);
    await act(async () => first.reject(new Error('연결을 확인하고 다시 시도해 주세요.')));
    expect(screen.getByRole('alert')).toHaveTextContent('다시 시도');
    expect(email).toHaveValue(CREDENTIALS.email);
    expect(password).toHaveValue(CREDENTIALS.password);
    expect(screen.getByRole('button', { name: buttonName, exact: true })).toBeEnabled();
    fireEvent.submit(form);
    expect(boundary[operation]).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(SESSION));
    expect(await screen.findByRole('heading', { name: destination })).toBeInTheDocument();
    expect(boundary.trackEvent).toHaveBeenCalledTimes(1);
  });

  it('does not navigate or send completion analytics after the user leaves the submitting page', async () => {
    const pending = deferred(); boundary[operation].mockReturnValue(pending.promise);
    const { form } = await openPage(operation);
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole('link', { name: '다른 작업으로 이동' }));
    expect(await screen.findByRole('heading', { name: '다른 작업' })).toBeInTheDocument();
    await act(async () => pending.resolve(SESSION));
    // The service still owns authentication; the abandoned page must not hijack navigation.
    await waitFor(() => expect(screen.getByText('로그인 상태')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: '다른 작업' })).toBeInTheDocument();
    expect(boundary.trackEvent).not.toHaveBeenCalled();
  });

  it('does not surface an abandoned request failure on another page', async () => {
    const pending = deferred(); boundary[operation].mockReturnValue(pending.promise);
    const { form } = await openPage(operation);
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole('link', { name: '다른 작업으로 이동' }));
    await act(async () => pending.reject(new Error('이전 화면 요청 실패')));
    expect(screen.getByRole('heading', { name: '다른 작업' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(boundary.trackEvent).not.toHaveBeenCalled();
  });

  it.each(['another pathname', 'a new history entry at the same pathname'])(
    'discards success when the browser reaches %s while the old page remains mounted', async boundaryChange => {
      window.history.replaceState({ key: 'submitted-page' }, '', `/${operation}`);
      const pending = deferred(); boundary[operation].mockReturnValue(pending.promise);
      const { form } = await openPage(operation);
      fireEvent.submit(form);
      // BrowserRouter can update history before a suspended route replaces the
      // old UI. Keep that UI mounted while changing the real browser boundary.
      window.history.pushState({ key: 'next-page' }, '', boundaryChange === 'another pathname' ? '/other' : `/${operation}`);
      expect(form).toBeInTheDocument();
      await act(async () => pending.resolve(SESSION));
      expect(boundary.trackEvent).not.toHaveBeenCalled();
      expect(form).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: destination })).not.toBeInTheDocument();
      expect(window.history.state.key).toBe('next-page');
    },
  );

  it('starts an unlocked new form after a same-path browser navigation and ignores the previous request failure', async () => {
    const first = deferred(); const second = deferred();
    boundary[operation].mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { form } = await openPage(operation, { browser: true });
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole('link', { name: '같은 화면 새로 열기' }));
    await waitFor(() => expect(screen.getByRole('button', { name: buttonName, exact: true })).toBeEnabled());
    expect(screen.getByLabelText('이메일')).toHaveValue('');
    expect(screen.getByLabelText(/^비밀번호/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: CREDENTIALS.email } });
    fireEvent.change(screen.getByLabelText(/^비밀번호/), { target: { value: CREDENTIALS.password } });
    const newForm = screen.getByLabelText('이메일').closest('form');
    fireEvent.submit(newForm);
    expect(boundary[operation]).toHaveBeenCalledTimes(2);
    await act(async () => first.reject(new Error('지난 화면 요청 실패')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(newForm.querySelector('button[type="submit"]')).toBeDisabled();
    await act(async () => second.resolve(SESSION));
    expect(await screen.findByRole('heading', { name: '계정 화면' })).toBeInTheDocument();
    expect(screen.getByText('로그인 상태')).toBeInTheDocument();
    expect(boundary.trackEvent).toHaveBeenCalledTimes(1);
  });
});
