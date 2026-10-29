import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPage from '../AccountPage';
import { exportUserData } from '../../api/authApi';

vi.mock('../../api/authApi', () => ({ exportUserData: vi.fn() }));

const authState = {
  deleteAccount: vi.fn(),
  dismissGuestImport: vi.fn(),
  error: '',
  guestImportPrompt: { available: false, count: 0, loading: false },
  importGuestIngredients: vi.fn(),
  logout: vi.fn(),
  user: { id: 'user-1', email: 'user@example.com' }
};

const ingredientsState = {
  hasUnsyncedChanges: true,
  lastSyncedAt: null,
  loadIngredients: vi.fn(),
  markIngredientsDirty: vi.fn(),
  pullIngredientsFromServer: vi.fn(),
  pushIngredientsToServer: vi.fn(),
  syncError: '',
  syncStatus: 'dirty'
};

vi.mock('../../hooks/useAuth.js', () => ({
  useAuth: () => authState
}));

vi.mock('../../hooks/useIngredients.js', () => ({
  useIngredients: () => ingredientsState
}));

vi.mock('../../hooks/useMenuDecision.js', () => ({
  useMenuDecision: () => ({ guestDecisionAvailable: false, importGuestDecision: vi.fn(), syncing: false })
}));

vi.mock('../../components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('../../components/PreferenceSettingsPanel.jsx', () => ({ default: () => null }));

afterEach(cleanup);

describe('account asynchronous feedback', () => {
  afterEach(() => { authState.error = ''; ingredientsState.syncError = ''; ingredientsState.syncStatus = 'dirty'; });

  it('announces authentication and synchronization failures without moving focus', () => {
    const view = render(<AccountPage />);
    const action = screen.getByRole('button', { name: '서버에 백업하기' });
    action.focus();
    authState.error = '세션 복구가 필요합니다.';
    view.rerender(<AccountPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('세션 복구가 필요합니다.');
    authState.error = '';
    ingredientsState.syncError = '동기화하지 못했어요. 다시 시도해 주세요.';
    view.rerender(<AccountPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('동기화하지 못했어요');
    expect(action).toHaveFocus();
  });

  it('announces synchronization progress and success from a persistent live region', () => {
    const view = render(<AccountPage />);
    const status = screen.getByRole('status', { name: '재료 동기화 상태' });
    expect(status).toBeEmptyDOMElement();
    ingredientsState.syncStatus = 'syncing';
    view.rerender(<AccountPage />);
    expect(status).toHaveTextContent('동기화 중');
    ingredientsState.syncStatus = 'synced';
    view.rerender(<AccountPage />);
    expect(screen.getByRole('status', { name: '재료 동기화 상태' })).toBe(status);
    expect(status).toHaveTextContent('로컬 변경사항을 서버와 병합했습니다.');
  });
});

describe('AccountPage shared-device logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires confirmation and requests account-scoped local cleanup', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    authState.logout.mockResolvedValue({ ok: true, pending: false, localCleanupComplete: true });

    render(<AccountPage />);

    await user.click(screen.getByRole('button', { name: '이 기기 데이터도 지우고 로그아웃' }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('아직 서버에 저장하지 않은 변경사항'));
    expect(authState.logout).toHaveBeenCalledWith({ clearLocalData: true });
  });

  it('does not delete local data when the user cancels', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AccountPage />);

    await user.click(screen.getByRole('button', { name: '이 기기 데이터도 지우고 로그아웃' }));

    expect(authState.logout).not.toHaveBeenCalled();
  });
});

describe('AccountPage privacy actions', () => {
  const exportDocument = {
    schemaVersion: 2,
    generatedAt: '2026-09-28T00:00:00.000Z',
    account: { id: 'user-1', email: 'user@example.com' },
    ingredients: [],
    importCorrections: [],
    recommendationEvents: [],
    menuDecisions: [],
    pantryOwnerships: [],
    preference: null,
    productEvents: []
  };
  let createObjectURL;
  let revokeObjectURL;
  let downloads;

  beforeEach(() => {
    vi.clearAllMocks();
    exportUserData.mockReset();
    authState.deleteAccount.mockReset();
    authState.user = { id: 'user-1', email: 'user@example.com' };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T00:00:00.000Z'));
    createObjectURL = vi.fn(() => 'blob:account-export');
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
  }

  async function openDeleteForm(user) {
    await user.click(screen.getByRole('button', { name: '계정 삭제', exact: true }));
    return screen.getByLabelText('현재 비밀번호', { exact: true });
  }

  // A premature download, wrong password argument, or missing password reset breaks this behavior.
  it('downloads the resolved export payload and clears its password only after success', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    exportUserData.mockReturnValue(pending.promise);
    render(<AccountPage />);
    const password = screen.getByLabelText('내려받기 전 현재 비밀번호 확인');
    await user.type(password, 'export-password');
    await user.click(screen.getByRole('button', { name: '내 데이터 내려받기', exact: true }));

    expect(exportUserData).toHaveBeenCalledExactlyOnceWith('export-password');
    expect(screen.getByText('내 데이터를 준비하고 있습니다...')).toBeInTheDocument();
    expect(password).toHaveValue('export-password');
    expect(downloads).toEqual([]);

    await act(async () => { pending.resolve(exportDocument); });

    expect(screen.getByText('내 데이터 파일을 내려받았습니다.')).toBeInTheDocument();
    expect(screen.queryByText('내 데이터를 준비하고 있습니다...')).not.toBeInTheDocument();
    expect(password).toHaveValue('');
    expect(downloads).toEqual([{ href: 'blob:account-export', filename: 'fridgemate-data-2026-09-28.json', connected: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('application/json');
    const contents = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(JSON.parse(contents)).toEqual(exportDocument);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:account-export');
  });

  // Failed exports must not download a file or discard the password needed for a retry.
  it.each([
    ['현재 비밀번호를 확인해주세요.', '현재 비밀번호를 확인해주세요.'],
    ['', '내 데이터를 내려받지 못했습니다.']
  ])('keeps export input and exposes rejection without a download (%s)', async (message, expectedError) => {
    const user = userEvent.setup();
    exportUserData.mockRejectedValue(new Error(message));
    render(<AccountPage />);
    const password = screen.getByLabelText('내려받기 전 현재 비밀번호 확인');
    await user.type(password, 'retry-password');
    await user.click(screen.getByRole('button', { name: '내 데이터 내려받기', exact: true }));

    expect(await screen.findByText(expectedError)).toBeInTheDocument();
    expect(password).toHaveValue('retry-password');
    expect(screen.queryByText('내 데이터를 준비하고 있습니다...')).not.toBeInTheDocument();
    expect(screen.queryByText('내 데이터 파일을 내려받았습니다.')).not.toBeInTheDocument();
    expect(downloads).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  // Opening the form is not deletion; cancelling confirmation must preserve the form and password.
  it('does not delete the account when permanent deletion is cancelled', async () => {
    const user = userEvent.setup();
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AccountPage />);
    expect(screen.queryByRole('button', { name: '영구 삭제 확인' })).not.toBeInTheDocument();
    const password = await openDeleteForm(user);
    await user.type(password, 'delete-password');
    expect(authState.deleteAccount).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '영구 삭제 확인' }));

    expect(confirmation).toHaveBeenCalledExactlyOnceWith('계정과 서버에 저장된 데이터를 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
    expect(authState.deleteAccount).not.toHaveBeenCalled();
    expect(password).toHaveValue('delete-password');
    expect(screen.queryByText('계정과 데이터를 삭제하고 있습니다...')).not.toBeInTheDocument();
  });

  // Only confirmed submission may call the account action, with the deletion (not export) password.
  it('passes the deletion password after confirmation and waits for the account action', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    authState.deleteAccount.mockReturnValue(pending.promise);
    render(<AccountPage />);
    await user.type(screen.getByLabelText('내려받기 전 현재 비밀번호 확인'), 'different-export-password');
    await user.type(await openDeleteForm(user), 'delete-password');
    await user.click(screen.getByRole('button', { name: '영구 삭제 확인' }));

    expect(confirmation.mock.invocationCallOrder[0]).toBeLessThan(authState.deleteAccount.mock.invocationCallOrder[0]);
    expect(authState.deleteAccount).toHaveBeenCalledExactlyOnceWith('delete-password');
    expect(screen.getByText('계정과 데이터를 삭제하고 있습니다...')).toBeInTheDocument();
    await act(async () => { pending.resolve({ localCleanupComplete: true }); });
    expect(screen.queryByText('계정을 삭제하지 못했습니다.')).not.toBeInTheDocument();
    expect(exportUserData).not.toHaveBeenCalled();
  });

  // Rejected deletion must remove the in-progress notice and leave the user able to retry.
  it.each([
    ['삭제 요청을 처리하지 못했습니다.', '삭제 요청을 처리하지 못했습니다.'],
    ['', '계정을 삭제하지 못했습니다.']
  ])('keeps the deletion form and exposes rejection (%s)', async (message, expectedError) => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    authState.deleteAccount.mockRejectedValue(new Error(message));
    render(<AccountPage />);
    const password = await openDeleteForm(user);
    await user.type(password, 'retry-delete-password');
    await user.click(screen.getByRole('button', { name: '영구 삭제 확인' }));

    expect(await screen.findByText(expectedError)).toBeInTheDocument();
    expect(password).toHaveValue('retry-delete-password');
    expect(screen.getByRole('button', { name: '영구 삭제 확인' })).toBeEnabled();
    expect(screen.queryByText('계정과 데이터를 삭제하고 있습니다...')).not.toBeInTheDocument();
  });

  // Extracting an inline component or adding a changing key would reset these inputs on rerender.
  it('keeps privacy form state when unrelated account information rerenders', async () => {
    const user = userEvent.setup();
    const view = render(<AccountPage />);
    await user.type(screen.getByLabelText('내려받기 전 현재 비밀번호 확인'), 'export-draft');
    await user.type(await openDeleteForm(user), 'delete-draft');

    authState.user = { ...authState.user, email: 'updated@example.com' };
    view.rerender(<AccountPage />);

    expect(screen.getByRole('heading', { name: 'updated@example.com' })).toBeInTheDocument();
    expect(screen.getByLabelText('내려받기 전 현재 비밀번호 확인')).toHaveValue('export-draft');
    expect(screen.getByLabelText('현재 비밀번호', { exact: true })).toHaveValue('delete-draft');
    expect(screen.getByRole('button', { name: '영구 삭제 확인' })).toBeInTheDocument();
  });
});
