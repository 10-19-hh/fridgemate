import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ShoppingNotesPanel from '../ShoppingNotesPanel';
import { clearAccountLocalData, getAllIngredients, saveIngredient } from '../../db/indexedDB';
import { getShoppingWorkspace, saveManualShoppingItem } from '../../features/shopping/shoppingRepository';

beforeAll(() => { Object.defineProperty(window, 'indexedDB', { configurable: true, value: new FDBFactory() }); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-16T01:00:00Z'));
  await clearAccountLocalData('guest'); await clearAccountLocalData('user:alice');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '장보기 메모 열기' }));
  return within(await screen.findByRole('form', { name: '수동 장보기 추가' }));
}

describe('shopping notes with real scoped storage', () => {
  it('persists manual check and purchase snapshots through deletion and reload without receiving stock', async () => {
    const raw = { id: 'milk', name: '우유', quantity: '기존 재구매 원문', consumed: true, memo: '재고 보존' };
    await saveIngredient(raw, 'guest');
    const view = render(<ShoppingNotesPanel scope="guest" />); const form = await open();
    fireEvent.change(form.getByLabelText('품목 이름'), { target: { value: '우유' } });
    fireEvent.change(form.getByLabelText('필요량 메모'), { target: { value: '200ml' } });
    fireEvent.change(form.getByLabelText('내 메모'), { target: { value: '요리용 별도 주문' } });
    fireEvent.click(form.getByLabelText('장보기 체크'));
    fireEvent.click(form.getByRole('button', { name: '수동 항목 추가' }));
    await screen.findByText('수동 항목을 저장했어요.');
    let manual = within(screen.getByRole('form', { name: '우유 수동 항목' }));
    expect(manual.getByLabelText('장보기 체크')).toBeChecked();
    expect(manual.getByLabelText('내 메모')).toHaveValue('요리용 별도 주문');
    const purchaseForm = within(screen.getByRole('form', { name: '구매 메모 작성' }));
    const option = purchaseForm.getByRole('option', { name: /직접 입력.*우유/ });
    expect(purchaseForm.getByRole('option', { name: /재구매.*우유/ })).toBeInTheDocument();
    fireEvent.change(purchaseForm.getByLabelText('구매한 품목의 출처'), { target: { value: option.value } });
    expect(purchaseForm.getByLabelText('실제로 산 양')).toHaveValue('');
    fireEvent.change(purchaseForm.getByLabelText('실제로 산 양'), { target: { value: '1L 한 통' } });
    fireEvent.click(purchaseForm.getByRole('button', { name: '구매 메모 저장' }));
    await screen.findByText('구매 메모를 저장했어요.');
    manual = within(screen.getByRole('form', { name: '우유 수동 항목' }));
    fireEvent.click(manual.getByRole('button', { name: '수동 항목 제거' }));
    await screen.findByText('수동 항목을 제거했어요.');
    view.unmount(); render(<ShoppingNotesPanel scope="guest" />); await open();
    expect(screen.queryByRole('form', { name: '우유 수동 항목' })).not.toBeInTheDocument();
    const history = within(screen.getByRole('region', { name: '구매 메모 이력' }));
    expect(history.getByText(/실제로 산 양: 1L 한 통/)).toBeInTheDocument();
    expect(history.getByText(/기록 당시 필요량: 200ml/)).toBeInTheDocument();
    expect(history.getByText(/직접 입력: 우유/)).toBeInTheDocument();
    expect(await getAllIngredients('guest')).toEqual([raw]);
    const saved = await getShoppingWorkspace('guest', '2026-09-16');
    expect(saved.manualItems).toEqual([]); expect(saved.purchaseNotes).toHaveLength(1);
    expect(saved.purchaseNotes[0]).toMatchObject({ source: { name: '우유', quantityText: '200ml' }, actualQuantityText: '1L 한 통', inventoryApplied: false });
    expect((await getShoppingWorkspace('user:alice', '2026-09-16')).purchaseNotes).toEqual([]);
  });

  it('leaves a stale manual edit visible as unsaved and never overwrites another page’s newer memo', async () => {
    const id = 'manual:00000000-0000-4000-8000-000000000001';
    const values = { name: '두부', quantityText: '한 모', memo: '', checked: false };
    await saveManualShoppingItem({ scope: 'guest', id, expectedRevision: 0, values });
    render(<ShoppingNotesPanel scope="guest" />); await open();
    const form = within(screen.getByRole('form', { name: '두부 수동 항목' }));
    fireEvent.change(form.getByLabelText('내 메모'), { target: { value: '오래된 창' } });
    await saveManualShoppingItem({ scope: 'guest', id, expectedRevision: 1, values: { ...values, memo: '다른 창의 최신 메모' } });
    fireEvent.click(form.getByRole('button', { name: '수동 항목 저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('확인하지 못했어요');
    expect(form.getByLabelText('내 메모')).toHaveValue('오래된 창');
    expect(screen.queryByText('수동 항목을 저장했어요.')).not.toBeInTheDocument();
    expect((await getShoppingWorkspace('guest', '2026-09-16')).manualItems[0].memo).toBe('다른 창의 최신 메모');
    fireEvent.click(screen.getByRole('button', { name: '장보기 메모 새로고침' }));
    expect(await screen.findByDisplayValue('다른 창의 최신 메모')).toBeInTheDocument();
  });
});
