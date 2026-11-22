import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipeQuantitySessionProvider } from '../RecipeQuantitySession';
import { useRecipeQuantitySession } from '../../../hooks/useRecipeQuantitySession';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const initialContext = { scope: 'guest', inventoryRevision: 'stock:1', mealDate: '2026-09-15', ready: true };
function record(overrides = {}) {
  return {
    recipeId: 'test:one', recipeVersion: '1', inventoryRevision: 'stock:1', targetServings: 1,
    inventory: { scope: 'guest', mealDate: '2026-09-15', revision: 'manual:1', items: [] },
    ...overrides,
  };
}
let current;
function Consumer({ label = 'route one' }) {
  const session = useRecipeQuantitySession();
  useEffect(() => { current = session; }, [session]);
  return <div>{label}<output>{Object.keys(session?.confirmations ?? {}).join(',')}</output></div>;
}
function view(context = initialContext, label) {
  return <RecipeQuantitySessionProvider context={context}><Consumer label={label} /></RecipeQuantitySessionProvider>;
}

describe('recipe quantity confirmation session', () => {
  it('starts empty and retains only explicit per-recipe confirmations across child navigation', () => {
    const page = render(view());
    expect(current?.confirmations).toEqual({});
    act(() => current.confirm(record()));
    expect(current.confirmations['test:one']).toEqual(record());
    page.rerender(view(initialContext, 'route two'));
    expect(screen.getByText('route two')).toBeVisible();
    expect(current.confirmations['test:one']).toEqual(record());
    act(() => current.confirm(record({ recipeId: 'test:two' })));
    act(() => current.invalidate('test:one'));
    expect(Object.keys(current.confirmations)).toEqual(['test:two']);
  });

  it.each([
    { scope: 'user:next' }, { inventoryRevision: 'stock:2' }, { mealDate: '2026-09-16' }, { ready: false },
  ])('never exposes old confirmations after context changes %o, including returning to the old context', (change) => {
    const page = render(view());
    act(() => current?.confirm(record()));
    page.rerender(view({ ...initialContext, ...change }));
    expect(current?.confirmations).toEqual({});
    page.rerender(view());
    expect(current?.confirmations).toEqual({});
  });

  it('rejects stale callbacks captured before a scope change or invalidation', () => {
    const page = render(view());
    const stale = current?.confirm;
    page.rerender(view({ ...initialContext, scope: 'user:next' }));
    page.rerender(view());
    act(() => stale?.(record()));
    expect(current?.confirmations).toEqual({});
    const beforeBlur = current?.confirm;
    fireEvent(window, new Event('blur'));
    act(() => beforeBlur?.(record()));
    expect(current?.confirmations).toEqual({});
  });

  it.each([
    { recipeId: '' }, { recipeVersion: '' }, { inventoryRevision: 'old' },
    { targetServings: 0 }, { targetServings: Infinity },
    { inventory: { scope: 'user:someone', mealDate: '2026-09-15' } },
    { inventory: { scope: 'guest', mealDate: '2026-09-14' } },
  ])('rejects a confirmation with mismatched or missing binding %o', (change) => {
    render(view());
    act(() => current?.confirm(record(change)));
    expect(current?.confirmations).toEqual({});
  });

  it.each(['blur', 'hidden'])('clears all confirmations on %s without writing storage', (event) => {
    const setStorage = vi.spyOn(Storage.prototype, 'setItem');
    render(view());
    act(() => current?.confirm(record()));
    if (event === 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
    } else fireEvent(window, new Event('blur'));
    expect(current?.confirmations).toEqual({});
    expect(setStorage).not.toHaveBeenCalled();
  });

  it('copies confirmed input so external mutation cannot silently change a saved snapshot', () => {
    render(view());
    const input = record();
    act(() => current?.confirm(input));
    input.inventory.items.push({ amount: 123 });
    expect(current?.confirmations['test:one'].inventory.items).toEqual([]);
  });

  it('does not share personal confirmations across provider trees or remounts', () => {
    const page = render(view());
    act(() => current?.confirm(record()));
    page.unmount();
    render(view());
    expect(current?.confirmations).toEqual({});
  });
});
import { useEffect } from 'react';
