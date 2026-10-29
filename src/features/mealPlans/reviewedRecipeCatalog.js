// Empty contract used only for the first test-first RED run.
import publicRecipes from '../../data/publicRecipes.json';
import reviews from './reviewedRecipeSources.json';

function matchesReviewedSource(recipe, snapshot) {
  return ['externalId', 'name', 'ingredientsText', 'source', 'sourceUrl']
    .every((field) => recipe[field] === snapshot[field])
    && Array.isArray(recipe.steps) && recipe.steps.length === snapshot.steps.length
    && snapshot.steps.every((step, index) => recipe.steps[index]?.order === step.order
      && recipe.steps[index]?.text === step.text);
}

function toComponent(review) {
  const { sourceSnapshot: source, sourceSha256, book } = review;
  return structuredClone({
    id: `mfds:${source.externalId}`,
    recipeKey: `mfds:${source.externalId}`,
    recipeVersion: `sha256:${sourceSha256}`,
    reviewVersion: review.reviewVersion,
    title: source.name,
    role: 'side',
    source: {
      kind: 'mfds-source-comparison', id: source.externalId,
      name: source.source, url: source.sourceUrl, book,
      reviewedAt: review.reviewedAt, reviewMethod: review.reviewMethod,
      comparisonNote: review.comparisonNote,
    },
    servings: review.servings,
    servingsStatus: 'verified',
    servingsEvidence: review.servingsEvidence,
    nutrition: null,
    nutritionStatus: 'unavailable',
    ingredients: review.ingredients.map((line) => ({
      ...line, optional: false, selected: true,
      quantityStatus: line.amount === null ? 'unverified' : 'verified',
      quantityEvidence: line.amount === null ? null
        : `PDF ${book.pdfPage} / ${book.printedPages.join('–')}쪽 재료표 및 COOKRCP01 ${source.externalId}: ${line.sourceLocation.text}`,
    })),
    // Processing water is retained separately; this catalog does not assert
    // complete cooking quantities or make a cookability/inventory decision.
    processInputs: review.processInputs,
  });
}

/** Only expose a review while its ingredient and method source is unchanged. */
export function getReviewedRecipeCatalog(sourceRecipes = publicRecipes) {
  const components = [];
  const blocked = [];
  for (const review of reviews) {
    const externalId = review.sourceSnapshot.externalId;
    const matches = sourceRecipes.filter((recipe) => recipe.externalId === externalId);
    const reason = matches.length === 0 ? 'missing-source'
      : matches.length > 1 ? 'ambiguous-source'
        : !matchesReviewedSource(matches[0], review.sourceSnapshot) ? 'source-changed' : null;
    if (reason) blocked.push({ externalId, reason });
    else components.push(toComponent(review));
  }
  return { components, blocked };
}
