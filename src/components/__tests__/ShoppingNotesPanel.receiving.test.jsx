import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ShoppingNotesPanel from '../ShoppingNotesPanel';
import { clearAccountLocalData, getAllIngredients } from '../../db/indexedDB';
import * as shopping from '../../features/shopping/shoppingRepository';
import { getInventoryQuantitySnapshot } from '../../features/mealPlans/inventoryQuantityRepository';

const source = { source: 'manual', sourceId: 'manual:chicken@1', name: '닭고기', quantityText: '200g', context: '직접 입력' };
beforeAll(() => { Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() }); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-16T08:00:00Z'));
  await clearAccountLocalData('guest'); await clearAccountLocalData('user:alice');
  await shopping.recordPurchaseNote({ scope: 'guest', operationId: 'purchase-one', source, actualQuantityText: '500g 한 팩', memo: '원래 구매 메모' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
  const history = within(await screen.findByRole('region', { name: '구매 메모 이력' }));
  fireEvent.click(history.getByText('입고할 양 확인', { exact: true }));
  return within(screen.getByRole('form', { name: '구매 반영 · 닭고기' }));
}
function fill(form) {
  fireEvent.change(form.getByLabelText('확인한 구매량'), { target: { value: '500' } });
  fireEvent.change(form.getByLabelText('입고 상태'), { target: { value: 'raw' } });
  fireEvent.change(form.getByLabelText('보관 장소'), { target: { value: '냉장' } });
  fireEvent.change(form.getByLabelText('유통기한(모르면 비워두기)'), { target: { value: '2026-09-23' } });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function delayReceiptAcknowledgement() {
  const committed = deferred();
  const acknowledgement = deferred();
  const apply = shopping.applyPurchaseReceipt;
  // Keep the real transaction and result; delay only delivery of its acknowledgement.
  vi.spyOn(shopping, 'applyPurchaseReceipt').mockImplementation(async input => {
    const receipt = await apply(input);
    committed.resolve(receipt);
    await acknowledgement.promise;
    return receipt;
  });
  return { committed, acknowledgement };
}

function InventoryParent({ today }) {
  const [state, setState] = useState({ amount: 0, refreshes: 0 });
  async function refresh() {
    const snapshot = await getInventoryQuantitySnapshot('guest');
    setState(previous => ({ amount: snapshot.inventory[0].amount, refreshes: previous.refreshes + 1 }));
  }
  return <>
    <output aria-label="부모 냉장고 상태">{state.amount}g · 갱신 {state.refreshes}회</output>
    <ShoppingNotesPanel scope="guest" today={today} onInventoryApplied={refresh} />
  </>;
}

describe('explicit receiving through shopping notes', () => {
  it('discards receipt focus intent if an awaited parent refresh crosses an account roundtrip', async () => {
    const gate = deferred(); const refresh = vi.fn(() => gate.promise);
    const view = render(<ShoppingNotesPanel scope="guest" onInventoryApplied={refresh} />);
    const form = await open(); fill(form);
    const button = form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }); button.focus(); fireEvent.click(button);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    view.rerender(<ShoppingNotesPanel scope="user:alice" onInventoryApplied={refresh} />);
    view.rerender(<ShoppingNotesPanel scope="guest" onInventoryApplied={refresh} />);
    const currentFocus = document.activeElement;
    await act(async () => gate.resolve());
    expect(document.activeElement).toBe(currentFocus);
    expect(screen.getByRole('heading', { name: '장보기 메모', exact: true })).not.toHaveFocus();
    expect(await getAllIngredients('guest')).toHaveLength(1);
    expect(await getAllIngredients('user:alice')).toEqual([]);
  });

  it('preserves focus moved to another task before the receipt acknowledgement', async () => {
    const gate = delayReceiptAcknowledgement();
    render(<><button>다른 작업</button><ShoppingNotesPanel scope="guest" /></>);
    const form = await open(); fill(form);
    const save = form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }); save.focus(); fireEvent.click(save);
    await act(async () => { await gate.committed.promise; });
    const outside = screen.getByRole('button', { name: '다른 작업' }); outside.focus();
    await act(async () => { gate.acknowledgement.resolve(); });
    await screen.findByText('입고 당시 500g · 현재 남은 양은 냉장고에서 확인해 주세요.');
    expect(outside).toHaveFocus(); expect(await getAllIngredients()).toHaveLength(1);
  });

  it.each([false, true])('restores receipt focus after success, including parent inventory reset=%s', async reset => {
    function ReceiptParent() {
      const [revision, setRevision] = useState(0);
      return <ShoppingNotesPanel scope="guest" resetKey={revision} onInventoryApplied={async () => {
        if (reset) setRevision(value => value + 1);
      }} />;
    }
    render(<StrictMode><ReceiptParent /></StrictMode>);
    const form = await open(); fill(form);
    const button = form.getByRole('button', { name: '확인한 구매량을 재고에 반영' });
    button.focus(); fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('heading', { name: '장보기 메모', exact: true })).toHaveFocus());
    expect((await getInventoryQuantitySnapshot()).inventory[0].amount).toBe(500);
    expect(await getAllIngredients()).toHaveLength(1);
  });

  it('preserves a committed receipt acknowledgement across midnight without reviving its old form', async () => {
    const gate = delayReceiptAcknowledgement();
    const view = render(<StrictMode><InventoryParent today="2026-09-16" /></StrictMode>);
    const form = await open(); fill(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }));
    await act(async () => { await gate.committed.promise; });
    view.rerender(<StrictMode><InventoryParent today="2026-09-17" /></StrictMode>);
    expect(screen.queryByRole('form', { name: '구매 반영 · 닭고기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '장보기 메모 새로고침' })).toBeDisabled();
    await act(async () => { gate.acknowledgement.resolve(); });
    await waitFor(() => expect(screen.getByLabelText('부모 냉장고 상태')).toHaveTextContent('500g · 갱신 1회'));
    expect(screen.queryByRole('form', { name: '구매 반영 · 닭고기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '장보기 메모 새로고침' })).toBeEnabled();
    expect((await shopping.getShoppingWorkspace('guest', '2026-09-17')).receipts).toHaveLength(1);
    expect((await getInventoryQuantitySnapshot('guest')).inventory[0].amount).toBe(500);
  });
  it('requires actual quantities and applies the package once while preserving the original purchase note', async () => {
    const view = render(<ShoppingNotesPanel scope="guest" />);
    const form = await open();
    expect(form.getByLabelText('확인한 구매량')).toHaveValue(null);
    expect(form.getByLabelText('포장 메모')).toHaveValue('500g 한 팩');
    expect(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' })).toBeDisabled();
    expect(await getAllIngredients()).toEqual([]);
    fill(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }));
    expect(await screen.findByText('입고 당시 500g · 현재 남은 양은 냉장고에서 확인해 주세요.')).toBeInTheDocument();
    expect((await getInventoryQuantitySnapshot()).inventory[0]).toMatchObject({ amount: 500, unit: 'g', quantityStatus: 'verified' });
    expect(screen.queryByText('입고할 양 확인', { exact: true })).not.toBeInTheDocument();
    view.unmount(); render(<ShoppingNotesPanel scope="guest" />);
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    await screen.findByText('입고 당시 500g · 현재 남은 양은 냉장고에서 확인해 주세요.');
    expect(await getAllIngredients()).toHaveLength(1);
    expect((await shopping.getShoppingWorkspace('guest', '2026-09-16')).purchaseNotes[0]).toMatchObject({ actualQuantityText: '500g 한 팩', memo: '원래 구매 메모', inventoryApplied: false });
  });

  it('allows receiving an unknown package without turning the package text into a number', async () => {
    render(<ShoppingNotesPanel scope="guest" />); const form = await open();
    fireEvent.click(form.getByLabelText('수량 모름'));
    fireEvent.change(form.getByLabelText('보관 장소'), { target: { value: '냉장' } });
    fireEvent.click(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }));
    await screen.findByText('입고 당시 수량 미확인 · 냉장고에서 남은 양을 확인해 주세요.');
    expect((await getInventoryQuantitySnapshot()).inventory[0]).toMatchObject({ quantity: '500g 한 팩', amount: null, quantityStatus: 'unverified' });
  });

  it('retains failed input and retry identity without claiming a successful receipt', async () => {
    const original = shopping.applyPurchaseReceipt;
    const apply = vi.spyOn(shopping, 'applyPurchaseReceipt').mockRejectedValueOnce(new Error('write failed'));
    render(<ShoppingNotesPanel scope="guest" />); const form = await open(); fill(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('확인하지 못했어요');
    expect(await getAllIngredients()).toEqual([]);
    expect(form.getByLabelText('확인한 구매량')).toHaveValue(500);
    apply.mockImplementation(original);
    fireEvent.click(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }));
    await screen.findByText('입고 당시 500g · 현재 남은 양은 냉장고에서 확인해 주세요.');
    expect(apply.mock.calls[0][0].operationId).toBe(apply.mock.calls[1][0].operationId);
    expect(await getAllIngredients()).toHaveLength(1);
  });

  it('clears the receiving form across account changes without submitting another account’s stock', async () => {
    const view = render(<ShoppingNotesPanel scope="guest" />); const form = await open(); fill(form);
    view.rerender(<ShoppingNotesPanel scope="user:alice" />);
    expect(screen.queryByRole('form', { name: '구매 반영 · 닭고기' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
    await screen.findByText('아직 구매 메모가 없어요.');
    expect(await getAllIngredients('guest')).toEqual([]);
    expect(await getAllIngredients('user:alice')).toEqual([]);
  });

  it('refreshes the same-account parent after a committed receipt even when focus discarded the old form', async () => {
    const gate = delayReceiptAcknowledgement();
    render(<StrictMode><InventoryParent /></StrictMode>);
    const form = await open(); fill(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }));
    await act(async () => { await gate.committed.promise; });
    expect((await getInventoryQuantitySnapshot('guest')).inventory[0]).toMatchObject({ amount: 500, unit: 'g' });
    expect(screen.getByLabelText('부모 냉장고 상태')).toHaveTextContent('0g · 갱신 0회');
    fireEvent.focus(window);
    fireEvent.focus(window);
    expect(screen.queryByRole('form', { name: '구매 반영 · 닭고기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '장보기 메모 새로고침' })).toBeDisabled();
    await act(async () => { gate.acknowledgement.resolve(); });
    await waitFor(() => expect(screen.getByLabelText('부모 냉장고 상태')).toHaveTextContent('500g · 갱신 1회'));
    expect(screen.getByText('다른 화면의 변경을 확인하려면 장보기 메모를 다시 불러 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '구매 반영 · 닭고기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '장보기 메모 새로고침' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 새로고침' }));
    await screen.findByText('입고 당시 500g · 현재 남은 양은 냉장고에서 확인해 주세요.');
    expect((await shopping.getShoppingWorkspace('guest', '2026-09-16')).receipts).toHaveLength(1);
    expect((await getInventoryQuantitySnapshot('guest')).inventory[0].amount).toBe(500);
  });

  it('keeps the committed receipt and reports a parent refresh failure after focus without reopening the old form', async () => {
    const gate = delayReceiptAcknowledgement();
    render(<ShoppingNotesPanel scope="guest" onInventoryApplied={async () => { throw new Error('Parent refresh failed'); }} />);
    const form = await open(); fill(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }));
    await act(async () => { await gate.committed.promise; });
    fireEvent.focus(window);
    await act(async () => { gate.acknowledgement.resolve(); });
    await waitFor(() => expect(screen.getAllByRole('status').map(node => node.textContent).join(' '))
      .toContain('입고는 저장됐지만 목록을 갱신하지 못했어요.'));
    expect((await getInventoryQuantitySnapshot('guest')).inventory[0].amount).toBe(500);
    expect(screen.queryByRole('form', { name: '구매 반영 · 닭고기' })).not.toBeInTheDocument();
  });

  it.each(['scope', 'disabled', 'resetKey', 'scope-roundtrip'])('does not revive a committed old receipt callback after %s invalidates its session', async field => {
    const gate = delayReceiptAcknowledgement();
    const refresh = vi.fn();
    const view = render(<ShoppingNotesPanel scope="guest" resetKey="before" onInventoryApplied={refresh} />);
    const form = await open(); fill(form);
    fireEvent.click(form.getByRole('button', { name: '확인한 구매량을 재고에 반영' }));
    await act(async () => { await gate.committed.promise; });
    const next = { scope: 'guest', resetKey: 'before', onInventoryApplied: refresh,
      ...(field === 'scope' || field === 'scope-roundtrip' ? { scope: 'user:alice' }
        : field === 'disabled' ? { disabled: true } : { resetKey: 'after' }) };
    view.rerender(<ShoppingNotesPanel {...next} />);
    if (field === 'scope-roundtrip') view.rerender(<ShoppingNotesPanel scope="guest" resetKey="before" onInventoryApplied={refresh} />);
    fireEvent.focus(window);
    await act(async () => { gate.acknowledgement.resolve(); });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(/입고 기록을 저장했어요|구매를 재고에 반영했어요/)).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '구매 반영 · 닭고기' })).not.toBeInTheDocument();
    expect((await getInventoryQuantitySnapshot('guest')).inventory[0].amount).toBe(500);
    expect(await getAllIngredients('user:alice')).toEqual([]);
  });
});
