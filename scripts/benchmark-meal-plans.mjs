import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { cpus, platform, arch, totalmem, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import { parseBenchmarkArguments } from './lib/mealPlanBenchmark.js';

const DOCUMENT_PATH = '/__meal_plan_benchmark__';
const MODULE_PATHS = [
  '/scripts/lib/mealPlanBenchmark.js',
  '/src/features/mealPlans/mealPlanDomain.js',
  '/src/features/mealPlans/mealPlanAllocation.js',
  '/src/features/mealPlans/mealQuantityDomain.js',
  '/src/features/mealPlans/mealPlanCatalog.js',
  '/src/features/mealPlans/reviewedDinnerCatalog.js',
  '/src/features/ingredients/ingredientDomain.js',
  '/src/features/nutrition/foodGroupRules.js',
  '/src/data/seedRecipes.js',
  '/src/data/pantryStaples.js',
];
const SOURCE_PATHS = [...MODULE_PATHS, '/scripts/benchmark-meal-plans.mjs'];

export function isAllowedBenchmarkRequest(url, method, origin) {
  try {
    const parsed = new URL(url);
    return method === 'GET' && parsed.origin === origin && !parsed.username && !parsed.password
      && !parsed.search && !parsed.hash && [DOCUMENT_PATH, ...MODULE_PATHS].includes(parsed.pathname);
  } catch { return false; }
}

async function assertOutputPath(path) {
  if (typeof path !== 'string' || !path.endsWith('.json') || path.includes('\0')) throw new TypeError('A JSON report path is required.');
  const target = resolve(path);
  const root = parse(target).root;
  let current = dirname(target);
  while (current !== root) {
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('Report parent symlink is not allowed; use its real path.');
    if (!info.isDirectory()) throw new Error('Report parent must be an existing directory.');
    current = dirname(current);
  }
  return target;
}

export async function writeBenchmarkReport(path, report) {
  const target = await assertOutputPath(path);
  const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8'); }
  finally { await handle.close(); }
}

async function main(args) {
  const options = parseBenchmarkArguments(args);
  if (options.help) {
    process.stdout.write('Usage: node scripts/benchmark-meal-plans.mjs --output NEW.json [--samples 20..500] [--warmup 0..50] [--weeks 1,4,12] [--port 4185]\nSynthetic local Chromium calculation benchmark; no application storage or external API.\n');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use the existing Node 24 runtime for this benchmark.');
  const output = await assertOutputPath(options.output);
  try { await lstat(output); throw new Error('The output already exists; select a new report path.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sourceHashes = async () => Object.fromEntries(await Promise.all(SOURCE_PATHS.map(async path => [
    path.slice(1), createHash('sha256').update(await readFile(resolve(root, path.slice(1)))).digest('hex'),
  ])));
  const initialHashes = await sourceHashes();
  const origin = `http://127.0.0.1:${options.port}`;
  const cacheDir = await mkdtemp(resolve(await realpath(tmpdir()), 'fridgemate-benchmark-vite-'));
  let server;
  let browser;
  let blockedRequestCount = 0;
  let requestCount = 0;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  try {
    const [{ createServer }, { chromium }] = await Promise.all([import('vite'), import('@playwright/test')]);
    server = await createServer({
      root, configFile: false, envFile: false, cacheDir, appType: 'custom', logLevel: 'error',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: options.port, strictPort: true, hmr: false, watch: null },
      plugins: [{ name: 'benchmark-static-only', configureServer(viteServer) {
        viteServer.middlewares.use((request, response, next) => {
          if (!isAllowedBenchmarkRequest(new URL(request.url, origin).href, request.method, origin)) {
            response.statusCode = 403; response.end('Benchmark modules only.'); return;
          }
          next();
        });
      } }],
    });
    await server.listen();
    browser = await chromium.launch({ headless: true, timeout: 30000 });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    await context.addInitScript(() => {
      const unavailable = () => { throw new Error('Application storage is forbidden in the calculation benchmark.'); };
      globalThis.indexedDB.open = unavailable;
      globalThis.indexedDB.deleteDatabase = unavailable;
      globalThis.Storage.prototype.setItem = unavailable;
      globalThis.Storage.prototype.removeItem = unavailable;
      globalThis.Storage.prototype.clear = unavailable;
    });
    await context.route('**/*', async route => {
      requestCount += 1;
      const request = route.request();
      if (!isAllowedBenchmarkRequest(request.url(), request.method(), origin)) {
        blockedRequestCount += 1; await route.abort('blockedbyclient'); return;
      }
      if (new URL(request.url()).pathname === DOCUMENT_PATH) {
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><title>Synthetic calculation benchmark</title><body></body></html>',
          headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'" } });
      } else await route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${origin}${DOCUMENT_PATH}`, { waitUntil: 'load', timeout: 30000 });
    const browserEnvironment = await page.evaluate(() => ({ userAgent: globalThis.navigator.userAgent,
      logicalConcurrency: globalThis.navigator.hardwareConcurrency, deviceMemoryGiB: globalThis.navigator.deviceMemory ?? null,
      viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight }, devicePixelRatio: globalThis.devicePixelRatio,
      locale: globalThis.navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    const scenarios = [];
    for (const futureWeeks of options.weeks) {
      let timer;
      const scenarioStarted = performance.now();
      try {
        const scenario = await Promise.race([
          page.evaluate(async settings => {
            const [workload, domain, allocation, catalog] = await Promise.all([
              import('/scripts/lib/mealPlanBenchmark.js'),
              import('/src/features/mealPlans/mealPlanDomain.js'),
              import('/src/features/mealPlans/mealPlanAllocation.js'),
              import('/src/features/mealPlans/mealPlanCatalog.js'),
            ]);
            return workload.runBenchmarkScenario({ generateMealPlan: domain.generateMealPlan,
              replaceMealPlanSlot: domain.replaceMealPlanSlot, allocateMealPlanInventory: allocation.allocateMealPlanInventory,
              catalog: catalog.getMealPlanCatalog() }, settings);
          }, { samples: options.samples, warmup: options.warmup, futureWeeks }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Benchmark scenario exceeded 60 seconds.')), 60000); }),
        ]);
        scenarios.push({ ...scenario, hostObservedScenarioMs: performance.now() - scenarioStarted });
      } finally { clearTimeout(timer); }
    }
    const finalHashes = await sourceHashes();
    if (JSON.stringify(initialHashes) !== JSON.stringify(finalHashes)) throw new Error('Calculation source files changed during measurement; no report accepted.');
    if (blockedRequestCount) throw new Error('Unexpected browser request was blocked; inspect the workload before accepting measurements.');
    const report = { schemaVersion: 1, kind: 'synthetic-local-calculation-benchmark', startedAt,
      finishedAt: new Date().toISOString(), hostObservedTotalMs: performance.now() - start,
      environment: { node: process.version, platform: platform(), architecture: arch(), localPort: options.port,
        cpuModel: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, ramBytes: totalmem(),
        browser: 'Chromium', browserVersion: browser.version(), headless: true, cpuThrottling: 'none',
        build: 'Vite development ESM; not a production bundle', viewportMode: 'desktop engine with mobile-sized viewport',
        ...browserEnvironment },
      isolation: { freshBrowserContext: true, applicationEntryLoaded: false, applicationStorageBlocked: true,
        externalRequestsAllowed: false, appApiAllowed: false, analyticsAllowed: false, requestCount, blockedRequestCount,
        sourceHashesUnchanged: true },
      methodology: { percentile: 'nearest-rank, ceil(p * n)', clock: 'browser performance.now()',
        repeatedBaseline: 'fresh input clones for each independent sample; no prior result reused',
        generation: 'one new seven-dinner draft; no future-week allocation',
        replacementAndShopping: 'replace the first week Thursday; recompute shopping across every future confirmed week',
        excluded: ['module loading', 'fixture construction', 'input cloning', 'result checks', 'IndexedDB I/O', 'DOM rendering', 'user interaction'],
        scope: 'guest; fixed date 2026-09-21; 2 adults; all 7 dinners; no pantry ownership',
        targets: { generationP95Ms: 2000, replacementAndShoppingP95Ms: 500, reviewedTemplates: 30, inventoryItems: 200 },
      },
      limitations: ['Synthetic inventory, not participant or production data.',
        'Existing catalog is measured as-is; no copied templates or invented reviewed quantities.',
        'Current catalog does not meet the 30-reviewed-combination workload target.',
        'Host CPU and viewport emulation do not represent a physical low-end phone.',
        'Pure calculations only: not end-to-end UI latency, pilot usability, or release approval.',
        'Local static-module allowlist is defense in depth, not a hardened operating-system sandbox.'],
      sourceHashes: finalHashes, scenarios,
    };
    await writeBenchmarkReport(output, report);
    process.stdout.write(`${JSON.stringify({ output, scenarios: scenarios.map(item => ({ futureWeeks: item.futureWeeks,
      generationP95Ms: item.generation.p95Ms, replacementAndShoppingP95Ms: item.replacementAndShopping.p95Ms,
      targetAssessment: item.targetAssessment })) })}\n`);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
