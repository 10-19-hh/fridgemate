// @vitest-environment node
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { allocateMealPlanInventory } from '../../src/features/mealPlans/mealPlanAllocation.js';
import { getMealPlanCatalog } from '../../src/features/mealPlans/mealPlanCatalog.js';
import { generateMealPlan, replaceMealPlanSlot } from '../../src/features/mealPlans/mealPlanDomain.js';

const libraryUrl = new URL('../lib/mealPlanBenchmark.js', import.meta.url);
const cliUrl = new URL('../benchmark-meal-plans.mjs', import.meta.url);
const library = existsSync(libraryUrl) ? await import(libraryUrl.href) : {};
const cli = existsSync(cliUrl) ? await import(cliUrl.href) : {};
const directories = [];

function feature(name, module = library) {
  expect(module[name], `Benchmark feature ${name} must be implemented`).toBeTypeOf('function');
  return module[name];
}

async function directory() {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'fridgemate-benchmark-test-'));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('meal planning benchmark statistics', () => {
  it('uses nearest-rank percentiles without sorting or changing the original measurements', () => {
    const summarize = feature('summarizeDurations');
    const samples = Object.freeze([20, 1, 19, 2, 18, 3, 17, 4, 16, 5, 15, 6, 14, 7, 13, 8, 12, 9, 11, 10]);
    expect(summarize(samples)).toEqual({ sampleCount: 20, minMs: 1, p50Ms: 10, p95Ms: 19, maxMs: 20 });
    expect(samples[0]).toBe(20);
  });

  it('preserves sub-millisecond and zero durations rather than rounding them into a false pass', () => {
    expect(feature('summarizeDurations')([0, 0.1, 0.25])).toEqual({
      sampleCount: 3, minMs: 0, p50Ms: 0.1, p95Ms: 0.25, maxMs: 0.25,
    });
  });

  it.each([[], [NaN], [Infinity], [-1], ['2'], new Array(2), null])('rejects invalid timing samples %j', samples => {
    const summarize = feature('summarizeDurations');
    expect(() => summarize(samples)).toThrow(/duration/i);
  });
});

describe('bounded benchmark arguments', () => {
  it('requires an explicit new report location and sets reproducible bounded defaults', () => {
    expect(feature('parseBenchmarkArguments')(['--output', '/tmp/new-report.json'])).toEqual({
      help: false, output: '/tmp/new-report.json', samples: 100, warmup: 5, weeks: [1, 4, 12], port: 4185,
    });
  });

  it('accepts explicit repeat counts and selected future-week scenarios', () => {
    expect(feature('parseBenchmarkArguments')(['--output', 'report.json', '--samples', '20', '--warmup', '0', '--weeks', '4,1', '--port', '4186']))
      .toMatchObject({ samples: 20, warmup: 0, weeks: [4, 1], port: 4186 });
  });

  it('allows help without a report or a browser', () => {
    expect(feature('parseBenchmarkArguments')(['--help'])).toEqual({ help: true });
  });

  it.each([
    [], ['--output'], ['--output', 'file.js'], ['--output', 'x.json', '--samples', '19'],
    ['--output', 'x.json', '--samples', '501'], ['--output', 'x.json', '--samples', '1e2'],
    ['--output', 'x.json', '--warmup', '-1'], ['--output', 'x.json', '--warmup', '51'],
    ['--output', 'x.json', '--weeks', '0'], ['--output', 'x.json', '--weeks', '13'],
    ['--output', 'x.json', '--weeks', '1,1'], ['--output', 'x.json', '--port', '80'],
    ['--output', 'x.json', '--port', '65536'], ['--output', 'x.json', '--model', 'ignored'],
    ['--output', 'x.json', '--samples', '20', '--samples', '30'], ['--help', '--unknown'],
  ])('rejects unsafe or ambiguous arguments %j before opening the browser', args => {
    const parse = feature('parseBenchmarkArguments');
    expect(() => parse(args)).toThrow();
  });
});

describe('actual local planning workload', () => {
  it('creates 200 deterministic synthetic batches from actual source identities without mutating the catalog', () => {
    const makeInventory = feature('createBenchmarkInventory');
    const catalog = getMealPlanCatalog();
    const original = structuredClone(catalog);
    const inventory = makeInventory(catalog);
    expect(inventory).toHaveLength(200);
    expect(new Set(inventory.map(item => item.id)).size).toBe(200);
    expect(inventory.every(item => item.scope === 'guest' && item.quantityEvidence === 'synthetic-benchmark-only')).toBe(true);
    expect(inventory.some(item => item.quantityStatus === 'unverified' && item.amount === null)).toBe(true);
    expect(inventory.some(item => item.expiryDate === null)).toBe(true);
    expect(inventory.some(item => item.expiryDate < '2026-09-21')).toBe(true);
    const knownKeys = new Set(catalog.flatMap(meal => meal.components.flatMap(component => component.ingredients.map(line => line.ingredientKey))).filter(Boolean));
    expect(inventory.every(item => knownKeys.has(item.ingredientKey))).toBe(true);
    expect(makeInventory(catalog)).toEqual(inventory);
    expect(catalog).toEqual(original);
  });

  // This CPU-heavy integration check runs 22 independent actual calculations.
  // Observed ~1s alone / 5.8s in the full parallel suite; its timeout is a hang
  // guard, not the product latency gate (the controlled browser benchmark is).
  it('runs real generation and replacement plus all four future weeks with warmups excluded', { timeout: 15000 }, () => {
    const run = feature('runBenchmarkScenario');
    const catalog = getMealPlanCatalog();
    const original = structuredClone(catalog);
    let tick = 0;
    // A deterministic timer isolates statistic accounting; all product calculations remain real.
    const result = run({ generateMealPlan, replaceMealPlanSlot, allocateMealPlanInventory, catalog }, {
      samples: 20, warmup: 2, futureWeeks: 4,
    }, () => ++tick);
    expect(result).toMatchObject({ futureWeeks: 4, inventoryCount: 200, plannedSlotCount: 28,
      generation: { sampleCount: 20, p95Ms: 1 }, replacementAndShopping: { sampleCount: 20, p95Ms: 1 },
      excludedWarmupIterations: 2, inputUnchanged: true, replacementChangedSlot: true,
      allocationSlotCount: 28, synthetic: true,
    });
    expect(result.generationSamplesMs).toEqual(Array(20).fill(1));
    expect(result.replacementAndShoppingSamplesMs).toEqual(Array(20).fill(1));
    expect(result.catalog).toMatchObject({ totalTemplates: 22, sourceQuantityComparedTemplates: 6,
      compositionOnlyTemplates: 16, completeQuantityTemplates: 0, targetTemplates: 30, targetDatasetReady: false });
    expect(result.targetAssessment).toBe('not-assessed-target-dataset-incomplete');
    expect(catalog).toEqual(original);
  });

  it('uses independent inputs so a mutating calculation cannot contaminate later samples or pass silently', () => {
    const run = feature('runBenchmarkScenario');
    const mutatingGenerate = input => {
      const result = generateMealPlan(input);
      input.ingredients[0].amount = -1;
      return result;
    };
    expect(() => run({ generateMealPlan: mutatingGenerate, replaceMealPlanSlot, allocateMealPlanInventory, catalog: getMealPlanCatalog() },
      { samples: 20, warmup: 0, futureWeeks: 1 })).toThrow(/mutated/i);
  });

  it.each([{ samples: 1 }, { warmup: 100 }, { futureWeeks: 0 }])('rejects malformed direct workload options %j', overrides => {
    const run = feature('runBenchmarkScenario');
    expect(() => run({ generateMealPlan, replaceMealPlanSlot, allocateMealPlanInventory, catalog: getMealPlanCatalog() },
      { samples: 20, warmup: 0, futureWeeks: 1, ...overrides })).toThrow();
  });
});

describe('exclusive benchmark report output', () => {
  it('writes a new JSON report and retains the complete timing evidence', async () => {
    const write = feature('writeBenchmarkReport', cli);
    const output = join(await directory(), 'result.json');
    await write(output, { synthetic: true, durations: [1.123, 2.456] });
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ synthetic: true, durations: [1.123, 2.456] });
  });

  it('refuses to overwrite an existing report', async () => {
    const write = feature('writeBenchmarkReport', cli);
    const output = join(await directory(), 'result.json');
    await writeFile(output, 'original');
    await expect(write(output, {})).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('original');
  });

  it('rejects a symlink destination and preserves its target', async () => {
    const write = feature('writeBenchmarkReport', cli);
    const root = await directory();
    const output = join(root, 'result.json');
    const original = join(root, 'original.json');
    await writeFile(original, 'original');
    await symlink(original, output);
    await expect(write(output, {})).rejects.toThrow();
    expect(await readFile(original, 'utf8')).toBe('original');
  });

  it('rejects a symlink parent rather than creating a report outside the selected directory', async () => {
    const write = feature('writeBenchmarkReport', cli);
    const root = await directory();
    const target = await directory();
    await symlink(target, join(root, 'linked'));
    await expect(write(join(root, 'linked', 'result.json'), {})).rejects.toThrow(/symlink/i);
    await expect(readFile(join(target, 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects non-JSON outputs or missing parents without creating directories', async () => {
    const write = feature('writeBenchmarkReport', cli);
    const root = await directory();
    await expect(write(join(root, 'source.js'), {})).rejects.toThrow();
    await expect(write(join(root, 'missing', 'result.json'), {})).rejects.toThrow();
    await expect(readFile(join(root, 'source.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('benchmark browser boundary', () => {
  it('allows only the exact local measurement document and calculation modules', () => {
    const allow = feature('isAllowedBenchmarkRequest', cli);
    expect(allow('http://127.0.0.1:4185/__meal_plan_benchmark__', 'GET', 'http://127.0.0.1:4185')).toBe(true);
    expect(allow('http://127.0.0.1:4185/src/features/mealPlans/mealPlanDomain.js', 'GET', 'http://127.0.0.1:4185')).toBe(true);
  });

  it.each([
    ['https://www.google-analytics.com/g/collect', 'GET'],
    ['http://127.0.0.1:4185/api/ingredients', 'GET'],
    ['http://127.0.0.1:4185/src/main.jsx', 'GET'],
    ['http://127.0.0.1:4185/.env', 'GET'],
    ['http://127.0.0.1:4185/@fs/etc/passwd', 'GET'],
    ['http://127.0.0.1:4186/src/features/mealPlans/mealPlanDomain.js', 'GET'],
    ['http://127.0.0.1:4185/src/features/mealPlans/mealPlanDomain.js', 'POST'],
    ['http://127.0.0.1:4185/src/features/mealPlans/mealPlanDomain.js?raw', 'GET'],
    ['http://user:password@127.0.0.1:4185/src/features/mealPlans/mealPlanDomain.js', 'GET'],
  ])('blocks non-benchmark request %s %s', (url, method) => {
    expect(feature('isAllowedBenchmarkRequest', cli)(url, method, 'http://127.0.0.1:4185')).toBe(false);
  });

  it('shows help without a browser or report and rejects unknown input before startup', () => {
    feature('writeBenchmarkReport', cli);
    const help = spawnSync(process.execPath, [cliUrl.pathname, '--help'], { encoding: 'utf8', timeout: 5000 });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage:');
    const invalid = spawnSync(process.execPath, [cliUrl.pathname, '--output', 'x.json', '--samples', '0'], { encoding: 'utf8', timeout: 5000 });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Invalid samples');
    expect(invalid.stdout).toBe('');
  });
});
