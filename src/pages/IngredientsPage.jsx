import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import IngredientFilters from '../components/IngredientFilters';
import IngredientList from '../components/IngredientList';
import InventoryReadError from '../components/InventoryReadError';
import InventoryQuantityReview from '../components/InventoryQuantityReview';
import PageHeader from '../components/PageHeader';
import ShoppingListPanel from '../components/ShoppingListPanel';
import ShoppingNotesPanel from '../components/ShoppingNotesPanel';
import {
  defaultIngredientFilters,
  filterIngredients,
  getConsumedIngredients,
  getDuplicateIngredientCleanupPlan
} from '../features/ingredients/ingredientSelectors';
import { useAnalytics } from '../hooks/useAnalytics';
import { useAuth } from '../hooks/useAuth';
import { useIngredients } from '../hooks/useIngredients';
import { getInventorySourceToken } from '../features/mealPlans/inventoryQuantityDomain';
import { getDaysToExpiryBucket } from '../utils/analytics';
import { isOcrEnabled } from '../utils/backendConfig';
import { ingredientCategories, storageTypes } from '../utils/ingredientOptions';

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const date = String(today.getDate()).padStart(2, '0');

  return `${year}-${month}-${date}`;
}

function IngredientsPage() {
  const { ingredients, loading, error, readError, removeIngredient, updateIngredient, loadIngredients } = useIngredients();
  const { storageScope, loading: authLoading } = useAuth();
  const { trackEvent } = useAnalytics();
  const ocrEnabled = isOcrEnabled();
  const [filters, setFilters] = useState(defaultIngredientFilters);

  const filteredIngredients = useMemo(() => filterIngredients(ingredients, filters), [filters, ingredients]);
  const shoppingListItems = useMemo(() => getConsumedIngredients(ingredients), [ingredients]);
  const activeIngredientCount = useMemo(() => ingredients.filter((ingredient) => !ingredient.consumed).length, [ingredients]);
  const duplicateCleanupPlan = useMemo(() => getDuplicateIngredientCleanupPlan(ingredients), [ingredients]);
  const quantityResetKey = useMemo(() => JSON.stringify(ingredients.map(getInventorySourceToken)), [ingredients]);
  const refreshAfterReceipt = useCallback(() => loadIngredients({ force: true }), [loadIngredients]);

  const handleFilterChange = useCallback((field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
  }, []);

  const handleToggleConsumed = useCallback(
    async (ingredient) => {
      try {
        await updateIngredient({
          ...ingredient,
          consumed: !ingredient.consumed,
          ...(ingredient.consumed ? { purchaseDate: getTodayDateString() } : {})
        });

        if (ingredient.consumed) {
          trackEvent('ingredient_restored', {
            days_to_expiry_bucket: getDaysToExpiryBucket(ingredient.expiryDate)
          });
        } else {
          trackEvent('ingredient_consumed', {
            days_to_expiry_bucket: getDaysToExpiryBucket(ingredient.expiryDate),
            source: 'ingredients_list'
          });
        }
      } catch {
        // Error state is surfaced from the hook.
      }
    },
    [trackEvent, updateIngredient]
  );

  const handleDelete = useCallback(
    async (id) => {
      try {
        await removeIngredient(id);
      } catch {
        // Error state is surfaced from the hook.
      }
    },
    [removeIngredient]
  );

  const handleSaveShoppingListDetails = useCallback(
    // The panel needs the rejection to retain its draft and show the failed save.
    (ingredient) => updateIngredient(ingredient),
    [updateIngredient]
  );

  const handleRestoreAllShoppingItems = useCallback(async () => {
    try {
      await Promise.all(
        shoppingListItems.map((ingredient) =>
          updateIngredient({
            ...ingredient,
            consumed: false,
            purchaseDate: getTodayDateString()
          })
        )
      );
    } catch {
      // Error state is surfaced from the hook.
    }
  }, [shoppingListItems, updateIngredient]);

  const handleCleanupDuplicateIngredients = useCallback(async () => {
    if (!duplicateCleanupPlan.removeCount) {
      return;
    }

    const confirmed = window.confirm(
      `동일한 재료 ${duplicateCleanupPlan.duplicateGroupCount}묶음을 구매일 기준으로 정리할까요?\n최신 구매일 항목만 남기고 ${duplicateCleanupPlan.removeCount}개를 삭제합니다.`
    );

    if (!confirmed) {
      return;
    }

    try {
      await Promise.all(duplicateCleanupPlan.removeIds.map((id) => removeIngredient(id)));
      trackEvent('ingredient_duplicates_cleaned', {
        duplicate_group_count: duplicateCleanupPlan.duplicateGroupCount,
        removed_count: duplicateCleanupPlan.removeCount
      });
    } catch {
      // Error state is surfaced from the hook.
    }
  }, [duplicateCleanupPlan, removeIngredient, trackEvent]);

  return (
    <div className="section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow={'\uC7AC\uB8CC \uAD00\uB9AC'}
        title={'\uC7AC\uB8CC\uB97C \uBE60\uB974\uAC8C \uCC3E\uACE0, \uC9C0\uAE08 \uC4F0\uC2E4 \uAC83\uBD80\uD130 \uC815\uB9AC\uD558\uC138\uC694'}
        description={
          '\uAC80\uC0C9\uACFC \uD544\uD130\uB85C \uBC94\uC704\uB97C \uC904\uC774\uACE0, \uC720\uD1B5\uAE30\uD55C \uC784\uBC15 \uC21C\uC73C\uB85C \uBCF4\uBA74 \uBB34\uC5C7\uC744 \uBA3C\uC800 \uCC98\uB9AC\uD560\uC9C0 \uBC14\uB85C \uBCF4\uC785\uB2C8\uB2E4.'
        }
        action={
          <>
            {ocrEnabled ? (
              <Link to="/import" className="btn-secondary">
                {'\uC2A4\uD06C\uB9B0\uC0F7 \uBD88\uB7EC\uC624\uAE30'}
              </Link>
            ) : null}
            <Link to="/ingredients/new" className="btn-primary">
              {'\uC7AC\uB8CC \uCD94\uAC00'}
            </Link>
          </>
        }
      />

      <IngredientFilters
        filters={filters}
        categories={ingredientCategories}
        storageTypes={storageTypes}
        onChange={handleFilterChange}
      />

      {!readError ? <section className="glass-card flex flex-col gap-3 px-4 py-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="summary-chip">{`\uBCF4\uC720 \uC911 ${activeIngredientCount}\uAC1C`}</span>
          <span className="summary-chip">{`\uAC80\uC0C9 \uACB0\uACFC ${filteredIngredients.length}\uAC1C`}</span>
          <span className="summary-chip">{`\uC7AC\uAD6C\uB9E4 \uD6C4\uBCF4 ${shoppingListItems.length}\uAC1C`}</span>
          {duplicateCleanupPlan.removeCount ? (
            <span className="summary-chip">{`\uC911\uBCF5 \uC815\uB9AC \uD6C4\uBCF4 ${duplicateCleanupPlan.removeCount}\uAC1C`}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {duplicateCleanupPlan.removeCount ? (
            <button className="btn-secondary min-h-[2.15rem] px-3 py-1.5 text-xs" onClick={handleCleanupDuplicateIngredients} type="button">
              {`\uC911\uBCF5 ${duplicateCleanupPlan.removeCount}\uAC1C \uC815\uB9AC`}
            </button>
          ) : null}
          <p className="text-xs muted">{'\uD575\uC2EC \uC561\uC158\uC740 \uC18C\uBE44 \uCC98\uB9AC, \uBCF4\uC870 \uC561\uC158\uC740 \uC218\uC815 \uC911\uC2EC\uC73C\uB85C \uBC30\uCE58\uD588\uC5B4\uC694.'}</p>
        </div>
      </section> : null}

      {!readError && duplicateCleanupPlan.removeCount ? (
        <section className="soft-panel space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="kicker">{'\uC911\uBCF5 \uC7AC\uB8CC \uAD00\uB9AC'}</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                {`\uB3D9\uC77C\uD55C \uC7AC\uB8CC ${duplicateCleanupPlan.duplicateGroupCount}\uBB36\uC74C\uC774 \uC788\uC5B4\uC694. \uAD6C\uB9E4\uC77C\uC774 \uAC00\uC7A5 \uCD5C\uADFC\uC778 \uD56D\uBAA9\uB9CC \uB0A8\uAE38 \uC218 \uC788\uC2B5\uB2C8\uB2E4.`}
              </p>
            </div>
            <button className="btn-primary" onClick={handleCleanupDuplicateIngredients} type="button">
              {'\uAD6C\uB9E4\uC77C \uAE30\uC900\uC73C\uB85C \uD558\uB098\uB9CC \uB0A8\uAE30\uAE30'}
            </button>
          </div>
          <p className="text-xs leading-5 muted">
            {'\uC18C\uBE44 \uCC98\uB9AC\uB41C \uC7AC\uB8CC\uB294 \uC7AC\uAD6C\uB9E4 \uD6C4\uBCF4\uB85C \uBCF4\uACE0 \uC790\uB3D9 \uC815\uB9AC\uC5D0\uC11C \uC81C\uC678\uD569\uB2C8\uB2E4.'}
          </p>
        </section>
      ) : null}

      <InventoryQuantityReview scope={storageScope} resetKey={quantityResetKey} disabled={loading || authLoading || Boolean(readError)} />

      <ShoppingNotesPanel scope={storageScope} resetKey={quantityResetKey} disabled={loading || authLoading || Boolean(readError)} onInventoryApplied={refreshAfterReceipt} />

      {!loading && !readError ? (
        <ShoppingListPanel
          items={shoppingListItems}
          onDelete={handleDelete}
          onRestore={handleToggleConsumed}
          onRestoreAll={handleRestoreAllShoppingItems}
          onSaveDetails={handleSaveShoppingListDetails}
        />
      ) : null}

      {loading ? <div className="card text-sm muted">{'\uC7AC\uB8CC\uB97C \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4...'}</div> : null}
      {readError ? <InventoryReadError loading={loading} onRetry={loadIngredients} /> : null}
      {error && !readError && !loading ? <div role="alert" className="card border border-rose-200 bg-rose-50 text-sm text-rose-700">{error}</div> : null}

      {!loading && !readError && !filteredIngredients.length ? (
        <EmptyState
          icon="🥕"
          title={'\uD604\uC7AC \uC870\uAC74\uC5D0 \uB9DE\uB294 \uC7AC\uB8CC\uAC00 \uC5C6\uC5B4\uC694'}
          description={'\uD544\uD130\uB97C \uBC14\uAFB8\uAC70\uB098 \uC0C8 \uC7AC\uB8CC\uB97C \uCD94\uAC00\uD574\uC11C \uBAA9\uB85D\uC744 \uCC44\uC6CC\uBCF4\uC138\uC694.'}
          actionLabel={'\uC7AC\uB8CC \uCD94\uAC00\uD558\uAE30'}
          actionTo="/ingredients/new"
        />
      ) : null}

      {!readError ? <IngredientList ingredients={filteredIngredients} onDelete={handleDelete} onToggleConsumed={handleToggleConsumed} /> : null}
    </div>
  );
}

export default IngredientsPage;
