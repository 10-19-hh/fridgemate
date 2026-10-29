import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountPrivacyPanel from '../AccountPrivacyPanel';
import { exportUserData } from '../../api/authApi';

vi.mock('../../api/authApi', () => ({ exportUserData: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('privacy action accessibility', () => {
  it('announces export progress and failure while preserving the password for retry', async () => {
    const pending = deferred();
    exportUserData.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<AccountPrivacyPanel deleteAccount={vi.fn()} />);
    await user.type(screen.getByLabelText('내려받기 전 현재 비밀번호 확인'), 'test-password');
    await user.click(screen.getByRole('button', { name: '내 데이터 내려받기', exact: true }));
    expect(screen.getByRole('status')).toHaveTextContent('내 데이터를 준비');
    await act(async () => pending.reject(new Error('비밀번호를 확인해 주세요.')));
    expect(screen.getByRole('alert')).toHaveTextContent('비밀번호를 확인해 주세요.');
    expect(screen.getByLabelText('내려받기 전 현재 비밀번호 확인')).toHaveValue('test-password');
    expect(screen.getByRole('button', { name: '내 데이터 내려받기', exact: true })).toBeEnabled();
  });

  // Same-tick form submissions must not start two downloads or a concurrent deletion.
  it('blocks repeated and competing submissions until an export settles, then permits retry', async () => {
    const pending = deferred();
    exportUserData.mockReturnValue(pending.promise);
    const deleteAccount = vi.fn();
    const user = userEvent.setup();
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccountPrivacyPanel deleteAccount={deleteAccount} />);
    await user.click(screen.getByRole('button', { name: '계정 삭제', exact: true }));
    const exportForm = screen.getByRole('button', { name: '내 데이터 내려받기', exact: true }).closest('form');
    const deleteForm = screen.getByRole('button', { name: '영구 삭제 확인' }).closest('form');
    act(() => { fireEvent.submit(exportForm); fireEvent.submit(exportForm); fireEvent.submit(deleteForm); });
    expect(exportUserData).toHaveBeenCalledTimes(1);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(confirmation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '내 데이터 내려받기', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: '영구 삭제 확인' })).toBeDisabled();
    await act(async () => pending.reject(new Error('다시 시도해 주세요.')));
    exportUserData.mockRejectedValue(new Error('연결을 확인해 주세요.'));
    fireEvent.submit(exportForm);
    expect(await screen.findByRole('alert')).toHaveTextContent('연결을 확인해 주세요.');
    expect(exportUserData).toHaveBeenCalledTimes(2);
  });

  it('blocks duplicate deletion confirmations and competing exports while deletion is pending', async () => {
    const pending = deferred();
    const deleteAccount = vi.fn(() => pending.promise);
    const user = userEvent.setup();
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccountPrivacyPanel deleteAccount={deleteAccount} />);
    await user.click(screen.getByRole('button', { name: '계정 삭제', exact: true }));
    const form = screen.getByRole('button', { name: '영구 삭제 확인' }).closest('form');
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    fireEvent.submit(screen.getByRole('button', { name: '내 데이터 내려받기', exact: true }).closest('form'));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(exportUserData).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('계정과 데이터를 삭제하고 있습니다');
    await act(async () => pending.reject(new Error('삭제하지 못했어요. 다시 시도해 주세요.')));
    expect(screen.getByRole('alert')).toHaveTextContent('삭제하지 못했어요');
    expect(screen.getByRole('button', { name: '영구 삭제 확인' })).toBeEnabled();
  });
});
