import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const recipeRecommendationsState = {
  recommendations: [
    { id: 'r1', title: 'ready', canMakeNow: true, missingCore: [], score: 80 },
    { id: 'r2', title: 'buy', canMakeNow: false, missingCore: ['양파'], matchedCore: ['계란'], score: 40 },
    { id: 'r3', title: 'soon', canMakeNow: false, missingCore: ['양파', '대파'], score: 20, useSoon: true }
  ],
  loading: false,
  error: '',
  ingredients: [{ id: 'i1', name: '계란', consumed: false, expiryDate: '2026-03-19' }]
};

vi.mock('../usePantryStaples.js', () => ({
  usePantryStaples: () => ({
    pantryStaples: [{ id: 'salt', name: '소금' }],
    pantryOwnership: { salt: 'owned' },
    pantrySummary: { owned: 1, missing: 0, unknown: 0 },
    syncError: '로컬 저장을 확인해주세요',
    saving: true,
    storageReady: false,
    canRetrySave: true,
    reloadPantryOwnership: 'reload-fixture',
    retryPantrySave: 'retry-fixture',
    cyclePantryStatus: vi.fn()
  })
}));

vi.mock('../useLocalRecommendations.js', () => ({
  useLocalRecommendations: () => recipeRecommendationsState
}));

describe('useRecipesPageModel', () => {
  it('builds grouped local recommendation sections', async () => {
    const { useRecipesPageModel } = await import('../useRecipesPageModel.js');
    const { result } = renderHook(() => useRecipesPageModel());

    expect(result.current.localRecommendations).toBe(recipeRecommendationsState.recommendations);
    expect(result.current.readyRecommendations).toHaveLength(1);
    expect(result.current.buyOneRecommendations).toHaveLength(1);
    expect(result.current.useSoonRecommendations).toHaveLength(1);
    expect(result.current.ownedPantryCount).toBe(1);
    expect(result.current.ownedPantryItems).toEqual(['소금']);
    expect(result.current).toMatchObject({ pantryError: '로컬 저장을 확인해주세요', pantrySaving: true,
      pantryStorageReady: false, pantryCanRetrySave: true, reloadPantryOwnership: 'reload-fixture', retryPantrySave: 'retry-fixture' });
  });
});
