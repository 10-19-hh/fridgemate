import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShoppingNotesPanel from '../ShoppingNotesPanel';
import * as repository from '../../features/shopping/shoppingRepository';

const SOURCE = { source: 'plan', sourceId: 'plan:rice', name: '밥', quantityText: '200 g', context: '9월 21일 저녁' };
const MANUAL = { id: 'manual:00000000-0000-4000-8000-000000000001', scope: 'guest', revision: 1,
  name: '우유', quantityText: '한 팩', memo: '가족 부탁', checked: false, createdAt: '2026-09-16T01:00:00.000Z', updatedAt: '2026-09-16T01:00:00.000Z' };
function workspace(overrides = {}) { return { scope: 'guest', manualItems: [], purchaseNotes: [], receipts: [], sources: [SOURCE], checkedAt: '2026-09-16', ...overrides }; }
function deferred() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { resolve, reject, promise }; }
async function open() { fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' })); return within(await screen.findByRole('form', { name: '수동 장보기 추가' })); }
function addValues(form) {
  fireEvent.change(form.getByLabelText('품목 이름'), { target: { value: '우유' } });
  fireEvent.change(form.getByLabelText('필요량 메모'), { target: { value: '한 팩' } });
  fireEvent.change(form.getByLabelText('내 메모'), { target: { value: '가족 부탁' } });
}
async function purchaseValues() {
  const form = within(screen.getByRole('form', { name: '구매 메모 작성' }));
  fireEvent.change(form.getByLabelText('구매한 품목의 출처'), { target: { value: '0' } });
  fireEvent.change(form.getByLabelText('실제로 산 양'), { target: { value: '500g 한 팩' } });
  return form;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T01:00:00Z'));
  vi.spyOn(repository, 'getShoppingWorkspace').mockResolvedValue(workspace());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('ShoppingNotesPanel', () => {
  it.each(['manual', 'purchase', 'remove'])('restores keyboard focus after %s replaces the saved forms', async kind => {
    vi.spyOn(repository, 'saveManualShoppingItem').mockResolvedValue(MANUAL);
    vi.spyOn(repository, 'recordPurchaseNote').mockResolvedValue({});
    vi.spyOn(repository, 'removeManualShoppingItem').mockResolvedValue(undefined);
    if (kind === 'remove') vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({ manualItems: [MANUAL] }));
    render(<ShoppingNotesPanel scope="guest" />);
    const add = await open();
    let button;
    if (kind === 'manual') { addValues(add); button = add.getByRole('button', { name: '수동 항목 추가' }); }
    else if (kind === 'purchase') button = (await purchaseValues()).getByRole('button', { name: '구매 메모 저장' });
    else button = screen.getByRole('button', { name: '수동 항목 제거' });
    button.focus(); fireEvent.click(button);
    await screen.findByText(kind === 'manual' ? '수동 항목을 저장했어요.' : kind === 'purchase' ? '구매 메모를 저장했어요.' : '수동 항목을 제거했어요.');
    expect(screen.getByRole('heading', { name: '장보기 메모', exact: true })).toHaveFocus();
    expect(within(screen.getByRole('form', { name: '수동 장보기 추가' })).getByLabelText('품목 이름')).toHaveValue('');
  });

  it('does not take focus back from another task after a pending shopping save', async () => {
    const gate = deferred(); vi.spyOn(repository, 'saveManualShoppingItem').mockReturnValueOnce(gate.promise);
    render(<><button>다른 작업</button><ShoppingNotesPanel scope="guest" /></>);
    const form = await open(); addValues(form);
    const button = form.getByRole('button', { name: '수동 항목 추가' }); button.focus(); fireEvent.click(button);
    const outside = screen.getByRole('button', { name: '다른 작업' }); outside.focus();
    await act(async () => gate.resolve(MANUAL));
    await screen.findByText('수동 항목을 저장했어요.'); expect(outside).toHaveFocus();
  });

  it('displays overdue meals as a read-only hold notice, not a purchase source', async () => {
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({
      overdueMeals: [{ slotId: '2026-09-14:dinner', date: '2026-09-14', title: '보류할 닭고기 한 끼' }],
    }));
    render(<ShoppingNotesPanel scope="guest" />);
    await open();
    expect(screen.getByRole('region', { name: '보류 중인 지난 끼니' })).toHaveTextContent('2026-09-14 · 보류할 닭고기 한 끼');
    expect(screen.queryByRole('option', { name: /보류할 닭고기 한 끼/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /식단.*밥/ })).toBeInTheDocument();
  });
  it('discards yesterday’s purchase sources and input before a fresh explicit read', async () => {
    const view = render(<ShoppingNotesPanel scope="guest" today="2026-09-16" />);
    await open();
    const form = await purchaseValues();
    expect(form.getByRole('button', { name: '구매 메모 저장' })).toBeEnabled();
    vi.setSystemTime(new Date('2026-09-17T01:00:00Z'));
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({ sources: [] }));
    view.rerender(<ShoppingNotesPanel scope="guest" today="2026-09-17" />);
    expect(screen.queryByRole('form', { name: '구매 메모 작성' })).not.toBeInTheDocument();
    expect(repository.getShoppingWorkspace).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 새로고침' }));
    await screen.findByRole('form', { name: '구매 메모 작성' });
    expect(screen.queryByRole('option', { name: /식단.*밥/ })).not.toBeInTheDocument();
    expect(repository.getShoppingWorkspace).toHaveBeenLastCalledWith('guest', '2026-09-17');
  });

  it('does not accept a late workspace read from before the day changed', async () => {
    const gate = deferred();
    vi.mocked(repository.getShoppingWorkspace).mockReturnValueOnce(gate.promise);
    const view = render(<ShoppingNotesPanel scope="guest" today="2026-09-16" />);
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    view.rerender(<ShoppingNotesPanel scope="guest" today="2026-09-17" />);
    await act(async () => gate.resolve(workspace({ manualItems: [MANUAL] })));
    expect(screen.queryAllByRole('form')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '장보기 메모 새로고침' })).toBeEnabled();
  });
  it('does not offer receiving when the receipt history is absent from a loaded snapshot', async () => {
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({ receipts: undefined }));
    render(<ShoppingNotesPanel scope="guest" />);
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('읽지 못했어요');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('limits text inputs to storage-accepted lengths instead of letting users enter unsavable notes', async () => {
    render(<ShoppingNotesPanel scope="guest" />); const manual = await open();
    expect(manual.getByLabelText('품목 이름')).toHaveAttribute('maxLength', '80');
    expect(manual.getByLabelText('필요량 메모')).toHaveAttribute('maxLength', '160');
    expect(manual.getByLabelText('내 메모')).toHaveAttribute('maxLength', '500');
    const purchase = within(screen.getByRole('form', { name: '구매 메모 작성' }));
    expect(purchase.getByLabelText('실제로 산 양')).toHaveAttribute('maxLength', '160');
    expect(purchase.getByLabelText('구매 메모')).toHaveAttribute('maxLength', '500');
  });

  it('opens only on request and explains that checks and purchase notes do not receive stock', async () => {
    render(<ShoppingNotesPanel scope="guest" />);
    expect(repository.getShoppingWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    await open();
    expect(repository.getShoppingWorkspace).toHaveBeenCalledWith('guest', '2026-09-16');
    expect(screen.getByText(/체크.*구매 메모.*재고.*반영하지/)).toBeInTheDocument();
  });

  it('keeps same-name sources separate and does not copy required quantity into actual purchase quantity', async () => {
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({ sources: [SOURCE,
      { ...SOURCE, source: 'manual', sourceId: MANUAL.id }, { ...SOURCE, source: 'repurchase', sourceId: 'rice-id' }] }));
    render(<ShoppingNotesPanel scope="guest" />); await open();
    const form = within(screen.getByRole('form', { name: '구매 메모 작성' }));
    expect(form.getByRole('option', { name: /식단.*밥/ })).toBeInTheDocument();
    expect(form.getByRole('option', { name: /직접 입력.*밥/ })).toBeInTheDocument();
    expect(form.getByRole('option', { name: /재구매.*밥/ })).toBeInTheDocument();
    fireEvent.change(form.getByLabelText('구매한 품목의 출처'), { target: { value: '0' } });
    expect(form.getByText(/필요량 메모: 200 g/)).toBeInTheDocument();
    expect(form.getByLabelText('실제로 산 양')).toHaveValue('');
    expect(form.getByRole('button', { name: '구매 메모 저장' })).toBeDisabled();
  });

  it('creates a manual row with revision zero then shows the saved data', async () => {
    const save = vi.spyOn(repository, 'saveManualShoppingItem').mockResolvedValue(MANUAL);
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValueOnce(workspace()).mockResolvedValue(workspace({ manualItems: [MANUAL] }));
    render(<ShoppingNotesPanel scope="guest" />); const form = await open(); addValues(form);
    fireEvent.click(form.getByRole('button', { name: '수동 항목 추가' }));
    expect(await screen.findByText('수동 항목을 저장했어요.')).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ scope: 'guest', id: expect.stringMatching(/^manual:/), expectedRevision: 0,
      values: { name: '우유', quantityText: '한 팩', memo: '가족 부탁', checked: false } }));
    expect(within(screen.getByRole('form', { name: '우유 수동 항목' })).getByLabelText('필요량 메모')).toHaveValue('한 팩');
  });

  it('saves edits and checks using the loaded revision and removes only that manual row', async () => {
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({ manualItems: [MANUAL] }));
    const save = vi.spyOn(repository, 'saveManualShoppingItem').mockResolvedValue({ ...MANUAL, revision: 2, checked: true });
    const remove = vi.spyOn(repository, 'removeManualShoppingItem').mockResolvedValue({ ...MANUAL, revision: 3, status: 'removed' });
    render(<ShoppingNotesPanel scope="guest" />); await open();
    let form = within(screen.getByRole('form', { name: '우유 수동 항목' }));
    fireEvent.click(form.getByLabelText('장보기 체크'));
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({ manualItems: [{ ...MANUAL, revision: 2, checked: true }] }));
    fireEvent.click(form.getByRole('button', { name: '수동 항목 저장' }));
    await screen.findByText('수동 항목을 저장했어요.');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: MANUAL.id, expectedRevision: 1, values: expect.objectContaining({ checked: true }) }));
    form = within(screen.getByRole('form', { name: '우유 수동 항목' }));
    expect(form.getByLabelText('장보기 체크')).toBeChecked();
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace());
    fireEvent.click(form.getByRole('button', { name: '수동 항목 제거' }));
    await screen.findByText('수동 항목을 제거했어요.');
    expect(remove).toHaveBeenCalledWith({ scope: 'guest', id: MANUAL.id, expectedRevision: 2 });
    expect(screen.queryByRole('form', { name: '우유 수동 항목' })).not.toBeInTheDocument();
  });

  it('keeps a failed purchase input and retries the same operation identity without announcing success', async () => {
    const save = vi.spyOn(repository, 'recordPurchaseNote').mockRejectedValue(new Error('uncertain write'));
    render(<ShoppingNotesPanel scope="guest" />); await open(); const form = await purchaseValues();
    fireEvent.click(form.getByRole('button', { name: '구매 메모 저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('확인하지 못했어요');
    expect(form.getByLabelText('실제로 산 양')).toHaveValue('500g 한 팩');
    expect(screen.queryByText('구매 메모를 저장했어요.')).not.toBeInTheDocument();
    const first = save.mock.calls[0][0];
    fireEvent.click(form.getByRole('button', { name: '구매 메모 저장' }));
    await screen.findByRole('alert');
    expect(save.mock.calls[1][0]).toEqual(first);
    expect(first).toMatchObject({ scope: 'guest', source: SOURCE, actualQuantityText: '500g 한 팩', memo: '' });
    fireEvent.change(form.getByLabelText('실제로 산 양'), { target: { value: '600g 한 팩' } });
    fireEvent.click(form.getByRole('button', { name: '구매 메모 저장' })); await screen.findByRole('alert');
    expect(save.mock.calls[2][0].operationId).not.toBe(first.operationId);
  });

  it('blocks duplicate clicks while a write is pending and displays purchase history independently of sources', async () => {
    const gate = deferred(); const note = { id: 'purchase:1', scope: 'guest', source: SOURCE, actualQuantityText: '500g 한 팩', memo: '', createdAt: '2026-09-16T01:00:00Z', inventoryApplied: false };
    const save = vi.spyOn(repository, 'recordPurchaseNote').mockReturnValue(gate.promise);
    render(<ShoppingNotesPanel scope="guest" />); await open(); const form = await purchaseValues();
    const button = form.getByRole('button', { name: '구매 메모 저장' }); fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled(); expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('구매 메모를 저장했어요.')).not.toBeInTheDocument();
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({ sources: [], purchaseNotes: [note] }));
    await act(async () => gate.resolve(note));
    expect(await screen.findByText('구매 메모를 저장했어요.')).toBeInTheDocument();
    const history = within(screen.getByRole('region', { name: '구매 메모 이력' }));
    expect(history.getByText(/500g 한 팩/)).toBeInTheDocument(); expect(history.getByText(/밥/)).toBeInTheDocument();
    expect(history.getByText(/재고 미반영/)).toBeInTheDocument();
  });

  it('recovers from a read failure without exposing editable forms', async () => {
    vi.mocked(repository.getShoppingWorkspace).mockRejectedValueOnce(new Error('read failed'));
    render(<ShoppingNotesPanel scope="guest" />);
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('새로고침');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 새로고침' }));
    expect(await screen.findByRole('form', { name: '수동 장보기 추가' })).toBeInTheDocument();
  });

  it('rejects a response for a different account instead of displaying it', async () => {
    vi.mocked(repository.getShoppingWorkspace).mockResolvedValue(workspace({ scope: 'user:other', manualItems: [MANUAL] }));
    render(<ShoppingNotesPanel scope="guest" />); fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(screen.queryByDisplayValue('우유')).not.toBeInTheDocument();
  });

  it.each(['scope', 'disabled', 'resetKey'])('discards a late read and old form when %s changes', async (field) => {
    const gate = deferred(); vi.mocked(repository.getShoppingWorkspace).mockReturnValueOnce(gate.promise);
    const view = render(<ShoppingNotesPanel scope="guest" resetKey="a" />);
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    const next = { scope: 'guest', resetKey: 'a', [field]: field === 'scope' ? 'user:alice' : field === 'disabled' ? true : 'b' };
    view.rerender(<ShoppingNotesPanel {...next} />);
    await act(async () => gate.resolve(workspace({ manualItems: [MANUAL] })));
    expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.queryByDisplayValue('우유')).not.toBeInTheDocument();
  });

  it('requires a fresh explicit read after focus, and ignores a prior in-flight response', async () => {
    const gate = deferred(); vi.mocked(repository.getShoppingWorkspace).mockReturnValueOnce(gate.promise);
    render(<ShoppingNotesPanel scope="guest" />); fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    fireEvent.focus(window); await act(async () => gate.resolve(workspace({ manualItems: [MANUAL] })));
    expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.getByText(/다시 불러/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 새로고침' }));
    expect(await screen.findByRole('form', { name: '수동 장보기 추가' })).toBeInTheDocument();
  });

  it('does not carry a late save notice into another account', async () => {
    const gate = deferred(); vi.spyOn(repository, 'saveManualShoppingItem').mockReturnValue(gate.promise);
    const view = render(<ShoppingNotesPanel scope="guest" />); const form = await open(); addValues(form);
    fireEvent.click(form.getByRole('button', { name: '수동 항목 추가' })); view.rerender(<ShoppingNotesPanel scope="user:alice" />);
    await act(async () => gate.resolve(MANUAL));
    expect(screen.queryByText('수동 항목을 저장했어요.')).not.toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});
