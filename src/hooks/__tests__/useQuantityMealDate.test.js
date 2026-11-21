import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQuantityMealDate } from '../useQuantityMealDate';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the local date binding for an individual cooking preview', () => {
  it('changes at local midnight, without keeping the previous day for a polling interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 23, 59, 59));
    const { result, unmount } = renderHook(useQuantityMealDate);
    expect(result.current).toBe('2026-09-15');
    act(() => vi.advanceTimersByTime(1002));
    expect(result.current).toBe('2026-09-16');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes the date after a suspended page resumes on another day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 12));
    const { result } = renderHook(useQuantityMealDate);
    vi.setSystemTime(new Date(2026, 8, 17, 12));
    fireEvent(window, new Event('focus'));
    expect(result.current).toBe('2026-09-17');
  });
});
