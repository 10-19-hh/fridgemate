import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ParsedItemEditor from '../ParsedItemEditor';
import OcrResultPanel from '../OcrResultPanel';

const candidate = (id, name) => ({ id, name, selected: true, quantity: '1개', unit: '개',
  category: '기타', storageType: '냉장', purchaseDate: '2026-09-28', expiryDate: '2026-10-02',
  memo: '', confidence: 0.8, duplicateExistingItems: [{ id: `old-${id}`, name }] });

describe('OCR review accessibility', () => {
  // A shared checkbox name would make separate (even identically named) candidates indistinguishable.
  it('identifies each candidate and its import and replacement controls without changing their target', () => {
    const onToggleItem = vi.fn();
    const onItemChange = vi.fn();
    render(<ParsedItemEditor items={[candidate('a', '두부'), candidate('b', '두부')]}
      onToggleItem={onToggleItem} onItemChange={onItemChange} />);
    const second = screen.getByRole('article', { name: '후보 2: 두부' });
    fireEvent.click(within(second).getByRole('checkbox', { name: '이 항목 가져오기: 후보 2 두부' }));
    fireEvent.click(within(second).getByRole('checkbox', { name: '기존 1개 항목 삭제 후 가져오기: 후보 2 두부' }));
    expect(onToggleItem).toHaveBeenCalledExactlyOnceWith('b');
    expect(onItemChange).toHaveBeenCalledExactlyOnceWith('b', 'replaceExisting', true);
    expect(within(screen.getByRole('article', { name: '후보 1: 두부' }))
      .getByRole('checkbox', { name: '이 항목 가져오기: 후보 1 두부' })).toBeChecked();
  });

  it('announces processing and successful recognition through the same persistent status region', () => {
    const view = render(<OcrResultPanel status="idle" progress={0} rawText="" />);
    const status = screen.getByRole('status', { name: '사진 인식 상태' });
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    view.rerender(<OcrResultPanel status="processing" progress={0.45} rawText="" />);
    expect(screen.getByRole('status', { name: '사진 인식 상태' })).toBe(status);
    expect(status).toHaveTextContent('사진에서 재료 찾는 중');
    expect(screen.getByRole('progressbar', { name: '사진 인식 진행률' })).toHaveAttribute('aria-valuenow', '45');
    view.rerender(<OcrResultPanel status="success" progress={1} rawText="두부 1개" />);
    expect(screen.getByRole('status', { name: '사진 인식 상태' })).toBe(status);
    expect(status).toHaveTextContent('사진 읽기가 끝났어요. 가져올 후보를 확인해 주세요.');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('announces an empty result and an error without reading the raw receipt aloud', () => {
    const view = render(<OcrResultPanel status="idle" rawText="" />);
    view.rerender(<OcrResultPanel status="success" rawText="" />);
    expect(screen.getByRole('status', { name: '사진 인식 상태' })).toHaveTextContent('재료로 보이는 내용을 찾지 못했어요');
    view.rerender(<OcrResultPanel status="error" error="다른 사진으로 다시 시도해 주세요." rawText="" />);
    expect(screen.getByRole('alert')).toHaveTextContent('다른 사진으로 다시 시도해 주세요.');
    expect(screen.getByRole('status', { name: '사진 인식 상태' })).toBeEmptyDOMElement();
  });
});
