import { Link, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import NotFoundPage from './NotFoundPage';
import {
  getPublicRecipeBySlug,
  getPublicRecipeDescription,
  getRecipeIngredientLines
} from '../features/recipes/publicRecipeCatalog';
import { getIngredientHubsForRecipe } from '../features/recipes/recipeContentHubs';
import { getRecipeEditorial, editorialReviewNote } from '../features/recipes/recipeEditorialContent';
import RecipePreparationChecklist from '../components/RecipePreparationChecklist';
import PublicRecipeQuantityPreview from '../features/recipes/PublicRecipeQuantityPreview';

const NUTRITION_FIELDS = [
  ['열량', 'calories', 'kcal'],
  ['탄수화물', 'carbohydrate', 'g'],
  ['단백질', 'protein', 'g'],
  ['지방', 'fat', 'g'],
  ['나트륨', 'sodium', 'mg']
];

function PublicRecipePage() {
  const { recipeSlug } = useParams();
  const recipe = getPublicRecipeBySlug(recipeSlug);

  if (!recipe) return <NotFoundPage />;

  const ingredientLines = getRecipeIngredientLines(recipe);
  const imageUrl = recipe.imageLargeUrl || recipe.imageSmallUrl;
  const relatedHubs = getIngredientHubsForRecipe(recipe);
  const editorial = getRecipeEditorial(recipe);

  return (
    <article className="section-shell mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="식약처 공개 레시피"
        title={recipe.name}
        description={getPublicRecipeDescription(recipe)}
        action={
          <Link to="/recipes" className="btn-secondary">
            메뉴 추천으로 돌아가기
          </Link>
        }
      />

      {editorial ? <section className="card space-y-4" aria-labelledby="recipe-choice-title">
        <div>
          <p className="kicker">오늘뭐먹지 활용 안내</p>
          <h2 id="recipe-choice-title" className="mt-2 text-xl font-semibold text-slate-950">이 메뉴를 고르면 좋은 상황</h2>
          <p className="mt-2 text-sm leading-7 text-slate-700">{editorial.selectionReason}</p>
        </div>
        <p className="text-sm text-slate-700">준비할 도구: {editorial.equipment.join(', ')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="soft-panel">
            <h3 className="font-semibold text-slate-900">조리 전에 확인할 점</h3>
            <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-slate-700">{editorial.preparationNotes.map((note) => <li key={note}>{note}</li>)}</ul>
          </div>
          <div className="soft-panel">
            <h3 className="font-semibold text-slate-900">재료를 바꾸고 싶다면</h3>
            <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-slate-700">{editorial.substitutionNotes.map((note) => <li key={note}>{note}</li>)}</ul>
          </div>
        </div>
        <p className="text-xs leading-5 text-slate-500">{editorialReviewNote} · 원문 대조 {editorial.reviewedAt}</p>
      </section> : null}

      <RecipePreparationChecklist key={recipe.externalId} recipe={recipe} />

      <section className="card overflow-hidden p-0">
        <img
          src={imageUrl}
          alt={`${recipe.name} 완성 이미지`}
          className="aspect-[16/9] w-full bg-slate-100 object-cover"
          decoding="async"
          fetchpriority="high"
        />
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          <div>
            <p className="kicker">요리 종류</p>
            <p className="mt-1 font-semibold text-slate-900">{recipe.dishType || '기타'}</p>
          </div>
          <div>
            <p className="kicker">조리 방법</p>
            <p className="mt-1 font-semibold text-slate-900">{recipe.cookingMethod || '정보 없음'}</p>
          </div>
          <div>
            <p className="kicker">기준 분량</p>
            <p className="mt-1 font-semibold text-slate-900">
              1인분{recipe.servingWeight ? ` (${recipe.servingWeight}g)` : ''}
            </p>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <p className="kicker">준비 재료</p>
          <h2 className="mt-1.5 text-xl font-semibold text-slate-900">{recipe.name} 재료</h2>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {ingredientLines.map((line) => (
            <li key={line} className="soft-panel text-sm leading-6 text-slate-700">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <PublicRecipeQuantityPreview publicRecipe={recipe} />

      <section className="card space-y-5">
        <div>
          <p className="kicker">만드는 방법</p>
          <h2 className="mt-1.5 text-xl font-semibold text-slate-900">{recipe.steps.length}단계 조리 순서</h2>
        </div>
        <ol className="space-y-5">
          {recipe.steps.map((step) => (
            <li key={step.order} className="grid gap-4 border-b border-slate-100 pb-5 last:border-0 last:pb-0 sm:grid-cols-[9rem_1fr]">
              {step.imageUrl ? (
                <img
                  src={step.imageUrl}
                  alt={`${recipe.name} ${step.order}단계`}
                  className="aspect-square w-full rounded-lg bg-slate-100 object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-500">
                  {step.order}단계
                </div>
              )}
              <div>
                <p className="kicker">{step.order}단계</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card space-y-4">
        <div>
          <p className="kicker">영양 정보</p>
          <h2 className="mt-1.5 text-xl font-semibold text-slate-900">식약처 제공 영양성분</h2>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {NUTRITION_FIELDS.map(([label, key, unit]) => (
            <div key={key} className="soft-panel text-center">
              <dt className="text-xs font-semibold text-slate-500">{label}</dt>
              <dd className="mt-1 text-lg font-semibold text-slate-900">
                {recipe.nutrition[key] == null ? '-' : `${recipe.nutrition[key]}${unit}`}
              </dd>
            </div>
          ))}
        </dl>
        {recipe.sodiumTip ? (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-xs font-bold text-emerald-800">나트륨 저감 조리 팁</p>
            <p className="mt-1 text-sm leading-6 text-emerald-950">{recipe.sodiumTip}</p>
          </div>
        ) : null}
      </section>

      <section className="card text-sm leading-6 text-slate-600">
        <p>
          이 페이지의 재료, 조리 순서, 이미지와 영양 정보는{' '}
          <a className="font-semibold text-brand-700 underline underline-offset-2" href={recipe.sourceUrl} rel="noreferrer" target="_blank">
            {recipe.source}
          </a>
          에서 제공받았습니다. 표시값은 원본 데이터 기준이며 식품 안전, 영양 또는 의료 조언을 대신하지 않습니다.
        </p>
      </section>

      {relatedHubs.length ? (
        <section className="card space-y-3">
          <div>
            <p className="kicker">비슷한 재료로 더 찾기</p>
            <h2 className="mt-1.5 text-xl font-semibold text-slate-900">관련 재료별 레시피</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {relatedHubs.map((hub) => (
              <Link key={hub.slug} to={hub.path} className="btn-secondary">
                {hub.name} 레시피 {hub.recipes.length}개
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

export default PublicRecipePage;
