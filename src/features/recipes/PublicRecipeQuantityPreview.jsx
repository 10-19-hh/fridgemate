import { useAuth } from '../../hooks/useAuth';
import { useIngredients } from '../../hooks/useIngredients';
import ScaledCookingPanel from './ScaledCookingPanel';
import { getQuantityRecipeForPublicRecipe } from './quantityRecipeCatalog';
import { useRecipeQuantitySession } from '../../hooks/useRecipeQuantitySession';

function ConfirmedSourcePreview({ recipe }) {
  const { storageScope, loading: authLoading } = useAuth();
  const { ingredients, inventoryScope, loading: inventoryLoading, error } = useIngredients();
  const session = useRecipeQuantitySession();

  if (authLoading || inventoryLoading || error || inventoryScope !== storageScope) {
    return (
      <section className="card text-sm text-slate-600" aria-label="분량 미리보기 준비">
        {error ? '냉장고 상태를 확인하지 못해 분량 미리보기를 잠시 닫았습니다. 새로고침 후 다시 확인해주세요.'
          : '분량 미리보기를 준비하고 있어요.'}
      </section>
    );
  }

  // A reset boundary only: never auto-fill or confirm legacy inventory strings.
  // This private key is not sent to a URL, storage, analytics, or public markup.
  // Quantity values are explicitly entered for this one meal in the child.
  const record = session?.confirmations[recipe.id];
  const confirmation = record?.recipeVersion === recipe.version ? record : null;
  return <div className="space-y-3"><ScaledCookingPanel recipe={recipe} scope={storageScope}
    contextKey={JSON.stringify([ingredients, session?.context.mealDate])}
    confirmation={session ? confirmation : undefined}
    onConfirm={session ? ({ inventory, targetServings, amounts }) => session.confirm({
      recipeId: recipe.id, recipeVersion: recipe.version,
      inventoryRevision: session.context.inventoryRevision, targetServings, inventory, amounts,
    }) : undefined}
    onInvalidate={session ? () => session.invalidate(recipe.id) : undefined}
  />
    {session ? <div className="space-y-1 text-sm leading-6 text-slate-600">
      <Link to="/recipes#recipe-recommendations" className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">추천 목록에서 보기</Link>
      <p>이 요리에 확인한 양만 목록에 반영해요. 새로고침·창 전환·재고 변경 후에는 다시 확인해 주세요.</p>
    </div> : null}
  </div>;
}

export default function PublicRecipeQuantityPreview({ publicRecipe }) {
  const recipe = getQuantityRecipeForPublicRecipe(publicRecipe);
  return recipe ? <ConfirmedSourcePreview recipe={recipe} /> : null;
}
import { Link } from 'react-router-dom';
