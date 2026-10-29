import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPage from '../AccountPage';
import { exportUserData } from '../../api/authApi';
import { beginAuthChange, finishAuthChange, updateAuthIdentity } from '../../features/auth/authSessionContext';

vi.mock('../../api/authApi', () => ({ exportUserData: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null, deleteAccount: vi.fn(), logout: vi.fn(),
  guestImportPrompt: { available: false }, error: '' }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../hooks/useIngredients', () => ({ useIngredients: () => ({ syncStatus: 'idle' }) }));
vi.mock('../../hooks/useMenuDecision', () => ({ useMenuDecision: () => ({ guestDecisionAvailable: false }) }));
vi.mock('../../components/PreferenceSettingsPanel', () => ({ default: () => null }));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function identify(id) {
  // A real session generation changes even when logging back into the same account.
  beginAuthChange();
  const context = updateAuthIdentity(id);
  finishAuthChange(context);
  auth.user = { id, email: `${id}@example.com` };
}
const exportInput = () => screen.getByLabelText('내려받기 전 현재 비밀번호 확인');
const exportButton = () => screen.getByRole('button', { name: '내 데이터 내려받기', exact: true });
function submitExport(value = 'fixture-password') {
  fireEvent.change(exportInput(), { target: { value } });
  fireEvent.submit(exportButton().closest('form'));
}
const payload = { schemaVersion: 2, account: { id: 'account-a', email: 'account-a@example.com' },
  ingredients: [], importCorrections: [], recommendationEvents: [], menuDecisions: [],
  pantryOwnerships: [], preference: null, productEvents: [] };
let createObjectURL; let revokeObjectURL; let download;
beforeEach(() => {
  vi.clearAllMocks();
  identify('account-a');
  createObjectURL = vi.fn(() => 'blob:privacy-fixture');
  revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); updateAuthIdentity(null);
  window.history.replaceState(null, '', '/');
});

describe('account privacy request ownership', () => {
  // The API may finish successfully after the route was left: no file may then be created.
  it('does not download a late export after leaving the account page', async () => {
    const pending = deferred();
    exportUserData.mockReturnValue(pending.promise);
    const view = render(<AccountPage />);
    submitExport();
    view.unmount();
    await act(async () => pending.resolve(payload));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('does not create a file once the panel DOM is disconnected, even before effect cleanup', async () => {
    const pending = deferred();
    exportUserData.mockReturnValue(pending.promise);
    const view = render(<AccountPage />);
    submitExport();
    view.container.remove();
    await act(async () => pending.resolve(payload));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    view.unmount();
  });

  it('cancels export during a browser navigation while the old route DOM is still mounted', async () => {
    const pending = deferred();
    exportUserData.mockReturnValue(pending.promise);
    window.history.replaceState({ key: 'account-first' }, '', '/account');
    render(<AccountPage />);
    submitExport();
    window.history.pushState({ key: 'recipes-next' }, '', '/recipes');
    await act(async () => pending.resolve(payload));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(exportInput()).toHaveValue('');
    expect(exportButton()).toBeEnabled();
  });

  it.each(['account-b', 'account-a'])('clears old passwords and confirmation on a new session for %s', async id => {
    const view = render(<AccountPage />);
    fireEvent.change(exportInput(), { target: { value: 'previous-export-password' } });
    fireEvent.click(screen.getByRole('button', { name: '계정 삭제', exact: true }));
    fireEvent.change(screen.getByLabelText('현재 비밀번호', { exact: true }), { target: { value: 'previous-delete-password' } });
    identify(id);
    view.rerender(<AccountPage />);
    expect(exportInput()).toHaveValue('');
    expect(screen.queryByRole('button', { name: '영구 삭제 확인' })).not.toBeInTheDocument();
    expect(exportButton()).toBeEnabled();
  });

  it('ignores an old export across A to B to A without unlocking the new pending request', async () => {
    const old = deferred(); const current = deferred();
    exportUserData.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = render(<AccountPage />);
    submitExport('old-password');
    identify('account-b'); view.rerender(<AccountPage />);
    identify('account-a'); view.rerender(<AccountPage />);
    submitExport('new-password');
    await act(async () => old.resolve(payload));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(exportInput()).toHaveValue('new-password');
    expect(exportButton()).toBeDisabled();
    expect(exportUserData.mock.calls).toEqual([['old-password'], ['new-password']]);
    await act(async () => current.reject(new Error('현재 요청 실패')));
    expect(screen.getByRole('alert')).toHaveTextContent('현재 요청 실패');
    expect(exportButton()).toBeEnabled();
  });

  it('rejects a stale form before sending a password after auth changes but before rerender', () => {
    exportUserData.mockResolvedValue(payload);
    render(<AccountPage />);
    fireEvent.change(exportInput(), { target: { value: 'account-a-password' } });
    identify('account-b');
    fireEvent.submit(exportButton().closest('form'));
    expect(exportUserData).not.toHaveBeenCalled();
  });

  it('does not download if session ownership changes before the export continuation', async () => {
    const pending = deferred();
    exportUserData.mockReturnValue(pending.promise);
    render(<AccountPage />);
    submitExport();
    // No React rerender is needed for the auth context fence to take effect.
    identify('account-b');
    await act(async () => pending.resolve(payload));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('does not display a previous account deletion failure in a new session', async () => {
    const pending = deferred();
    auth.deleteAccount.mockReturnValue(pending.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: '계정 삭제', exact: true }));
    fireEvent.change(screen.getByLabelText('현재 비밀번호', { exact: true }), { target: { value: 'old-delete-password' } });
    fireEvent.submit(screen.getByRole('button', { name: '영구 삭제 확인' }).closest('form'));
    identify('account-b'); view.rerender(<AccountPage />);
    fireEvent.change(exportInput(), { target: { value: 'new-draft' } });
    await act(async () => pending.reject(new Error('이전 계정의 삭제 실패')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(exportInput()).toHaveValue('new-draft');
    expect(exportButton()).toBeEnabled();
  });

  it('releases the temporary download URL and anchor if the browser download action fails', async () => {
    exportUserData.mockResolvedValue(payload);
    download.mockImplementation(() => { throw new Error('다운로드 요청 실패'); });
    render(<AccountPage />);
    submitExport();
    expect(await screen.findByRole('alert')).toHaveTextContent('다운로드 요청 실패');
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:privacy-fixture');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(exportInput()).toHaveValue('fixture-password');
    expect(exportButton()).toBeEnabled();
  });
});
