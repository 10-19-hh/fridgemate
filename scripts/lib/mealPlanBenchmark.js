// Browser-compatible helpers. This benchmark never opens application storage.
const TODAY = '2026-09-21';
const NOW = '2026-09-21T03:00:00.000Z';

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${label}.`);
  return value;
}

export function summarizeDurations(samples) {
  if (!Array.isArray(samples) || !samples.length
    || Array.from(samples).some(value => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('Durations must be nonempty finite nonnegative measurements.');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { sampleCount: sorted.length, minMs: sorted[0],
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1) };
}

export function parseBenchmarkArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = { help: false, output: null, samples: 100, warmup: 5, weeks: [1, 4, 12], port: 4185 };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]?.replace(/^--/, '');
    const value = args[index + 1];
    if (!['output', 'samples', 'warmup', 'weeks', 'port'].includes(name)
      || args[index] !== `--${name}` || seen.has(name) || typeof value !== 'string' || value.startsWith('--')) {
      throw new TypeError('Unknown, repeated, or incomplete benchmark argument.');
    }
    seen.add(name);
    if (name === 'output') options.output = value;
    else if (name === 'weeks') {
      if (!/^\d+(,\d+)*$/.test(value)) throw new TypeError('Invalid future weeks.');
      options.weeks = value.split(',').map(item => boundedInteger(Number(item), 1, 12, 'future weeks'));
      if (new Set(options.weeks).size !== options.weeks.length) throw new TypeError('Repeated future weeks.');
    } else {
      if (!/^\d+$/.test(value)) throw new TypeError(`Invalid ${name}.`);
      const bounds = { samples: [20, 500], warmup: [0, 50], port: [1024, 65535] }[name];
      options[name] = boundedInteger(Number(value), ...bounds, name);
    }
  }
  if (!options.output?.trim() || !options.output.endsWith('.json') || options.output.includes('\0')) {
    throw new TypeError('An explicit new --output report.json is required.');
  }
  return options;
}

function datePlus(days) {
  const date = new Date(`${TODAY}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createBenchmarkInventory(catalog) {
  const rows = new Map();
  for (const meal of catalog) for (const component of meal.components) for (const line of component.ingredients) {
    if (line.quantityStatus !== 'verified' || !line.ingredientKey || !line.unit || !line.preparationState) continue;
    const identity = JSON.stringify([line.ingredientKey, line.unit, line.preparationState]);
    if (!rows.has(identity)) rows.set(identity, line);
  }
  const available = [...rows.values()];
  if (!available.length) throw new Error('The actual catalog has no source-identified quantity rows for synthetic stock.');
  return Array.from({ length: 200 }, (_, index) => {
    const row = available[index % available.length];
    const unknown = index % 10 === 0;
    return { id: `synthetic-benchmark-batch-${index}`, scope: 'guest', name: row.rawName,
      normalizedName: row.normalizedName, ingredientKey: row.ingredientKey, preparationState: row.preparationState,
      unit: row.unit, amount: unknown ? null : 100 + (index % 7) * 50,
      quantityStatus: unknown ? 'unverified' : 'verified', quantityEvidence: 'synthetic-benchmark-only',
      expiryDate: index % 13 === 0 ? null : index % 17 === 0 ? datePlus(-1) : datePlus(14 + (index % 12) * 7),
      consumed: false, deletedAt: null };
  });
}

function catalogCounts(catalog) {
  const completeQuantityTemplates = catalog.filter(meal => meal.quantityStatus === 'verified'
    && meal.servingsStatus === 'verified' && meal.processQuantityStatus !== 'needs-review').length;
  return {
    totalTemplates: catalog.length,
    sourceQuantityComparedTemplates: catalog.filter(meal => meal.reviewStatus === 'source-quantity-compared').length,
    compositionOnlyTemplates: catalog.filter(meal => meal.reviewStatus === 'composition-only').length,
    completeQuantityTemplates, targetTemplates: 30, targetDatasetReady: completeQuantityTemplates >= 30,
  };
}

/** Timed intervals contain only actual pure product calculations. Input cloning,
 * result checks, fixture generation, module loading and browser startup are not
 * timed. Every sample starts from fresh copies of the same baseline. */
export function runBenchmarkScenario({ generateMealPlan, replaceMealPlanSlot, allocateMealPlanInventory, catalog },
  { samples, warmup, futureWeeks }, clock = () => performance.now()) {
  boundedInteger(samples, 20, 500, 'samples');
  boundedInteger(warmup, 0, 50, 'warmup');
  boundedInteger(futureWeeks, 1, 12, 'future weeks');
  const inventory = createBenchmarkInventory(catalog);
  const preferences = { servings: 2, dinnerDays: [0, 1, 2, 3, 4, 5, 6], excludedIngredients: [] };
  const baseInput = { weekStart: TODAY, scope: 'guest', now: NOW, preferences, ingredients: inventory, pantryItems: [] };
  const baseline = JSON.stringify(baseInput);
  const confirmedPlans = Array.from({ length: futureWeeks }, (_, index) => generateMealPlan({
    ...structuredClone(baseInput), weekStart: datePlus(index * 7),
  }));
  if (confirmedPlans.some(plan => plan.slots.length !== 7 || plan.slots.some(slot => slot.status !== 'planned'))) {
    throw new Error('Benchmark requires seven planned dinners per future week.');
  }
  const generationSamplesMs = [];
  const replacementAndShoppingSamplesMs = [];
  let allocation;
  for (let iteration = 0; iteration < warmup + samples; iteration++) {
    const generationInput = structuredClone(baseInput);
    const replacementInput = structuredClone({ confirmedPlans, inventory, pantryItems: [] });
    const originalGenerationInput = JSON.stringify(generationInput);
    const originalReplacementInput = JSON.stringify(replacementInput);
    const startedGeneration = clock();
    const generated = generateMealPlan(generationInput);
    const generationMs = clock() - startedGeneration;
    const slot = replacementInput.confirmedPlans[0].slots[3];
    const startedReplacement = clock();
    const replaced = replaceMealPlanSlot(replacementInput.confirmedPlans[0], slot.id, {
      ingredients: replacementInput.inventory, pantryItems: replacementInput.pantryItems, now: NOW,
    });
    allocation = allocateMealPlanInventory({ scope: 'guest', today: TODAY,
      confirmedPlans: [replaced, ...replacementInput.confirmedPlans.slice(1)], inventory: replacementInput.inventory });
    const replacementMs = clock() - startedReplacement;
    if (JSON.stringify(generationInput) !== originalGenerationInput
      || JSON.stringify(replacementInput) !== originalReplacementInput || JSON.stringify(baseInput) !== baseline) {
      throw new Error('Product calculation mutated benchmark inputs.');
    }
    if (generated.slots.length !== 7 || replaced.slots[3].templateKey === slot.templateKey
      || allocation.slots.length !== futureWeeks * 7) {
      throw new Error('Benchmark did not perform the intended generation, replacement and whole-future allocation.');
    }
    if (iteration >= warmup) {
      generationSamplesMs.push(generationMs);
      replacementAndShoppingSamplesMs.push(replacementMs);
    }
  }
  const generation = summarizeDurations(generationSamplesMs);
  const replacementAndShopping = summarizeDurations(replacementAndShoppingSamplesMs);
  const counts = catalogCounts(catalog);
  return {
    synthetic: true, today: TODAY, fixedNow: NOW, dinnerDays: 7, servings: 2, pantryOwnedCount: 0,
    inventoryCount: inventory.length, uniqueInventoryIdentities: new Set(inventory.map(item => item.ingredientKey)).size,
    futureWeeks, plannedSlotCount: futureWeeks * 7, excludedWarmupIterations: warmup,
    independentBaselinePerSample: true, inputUnchanged: true, replacementChangedSlot: true,
    allocationSlotCount: allocation.slots.length, allocationStatus: allocation.status,
    shortageGroupCount: allocation.shopping.shortages.length, reviewItemCount: allocation.shopping.needsReview.length,
    selectedSourceComparedSlotCount: confirmedPlans.flatMap(plan => plan.slots)
      .filter(slot => catalog.find(template => template.key === slot.templateKey)?.reviewStatus === 'source-quantity-compared').length,
    catalog: counts, engineVersion: confirmedPlans[0].engineVersion, catalogVersion: confirmedPlans[0].catalogVersion,
    generation, replacementAndShopping, generationSamplesMs, replacementAndShoppingSamplesMs,
    observedWithinTimeTargets: { generation: generation.p95Ms <= 2000, replacementAndShopping: replacementAndShopping.p95Ms <= 500 },
    targetAssessment: !counts.targetDatasetReady ? 'not-assessed-target-dataset-incomplete'
      : 'local-calculation-only-not-a-release-gate',
  };
}
