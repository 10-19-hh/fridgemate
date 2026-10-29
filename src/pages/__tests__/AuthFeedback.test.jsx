import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../LoginPage';
import SignupPage from '../SignupPage';

const auth = vi.hoisted(() => ({ backendEnabled: true, isAuthenticated: false, loading: false,
  error: '', login: vi.fn(), signup: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../utils/backendConfig', () => ({ isPublicSignupEnabled: () => true }));
beforeEach(() => { vi.clearAllMocks(); auth.error = ''; });
afterEach(() => vi.restoreAllMocks());

describe('authentication feedback', () => {
  it.each([
    ['login', LoginPage, '로그인', 'current-password'],
    ['signup', SignupPage, '회원가입', 'new-password'],
  ])('announces an asynchronous %s rejection without clearing entered values', async (operation, Page, label, passwordHint) => {
    let reject;
    auth[operation].mockReturnValue(new Promise((_, no) => { reject = no; }));
    render(<MemoryRouter><Page /></MemoryRouter>);
    const email = screen.getByLabelText('이메일');
    const password = screen.getByLabelText(/^비밀번호/);
    fireEvent.change(email, { target: { value: 'test@example.com' } });
    fireEvent.change(password, { target: { value: 'not-a-real-password!' } });
    fireEvent.submit(screen.getByRole('button', { name: label, exact: true }).closest('form'));
    await act(async () => reject(new Error('요청을 처리하지 못했어요. 다시 시도해 주세요.')));
    expect(screen.getByRole('alert')).toHaveTextContent('다시 시도해 주세요.');
    expect(email).toHaveValue('test@example.com');
    expect(password).toHaveValue('not-a-real-password!');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(password).toHaveAttribute('autocomplete', passwordHint);
    expect(screen.getByRole('button', { name: label, exact: true })).toBeEnabled();
  });

  it('announces a session recovery warning arriving after the login page is open', () => {
    const view = render(<MemoryRouter><LoginPage /></MemoryRouter>);
    auth.error = '세션을 확인하지 못했습니다. 다시 로그인해 주세요.';
    view.rerender(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent(auth.error);
  });
});
