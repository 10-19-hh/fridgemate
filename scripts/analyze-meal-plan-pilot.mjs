import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { summarizeMealPlanPilot } from '../src/features/mealPlans/mealPlanPilotMetrics.js';
import { summarizeLocalMealPlanPilotExport } from '../src/features/mealPlans/mealPlanPilotExport.js';

const MAX_BYTES = 12 * 1024 * 1024;
const FAILURE = 'Pilot analysis failed. Check the dataset, observation cutoff and a new regular JSON output path.';

function jsonPath(value) {
  if (typeof value !== 'string' || !value || path.extname(value) !== '.json'
    || value.split(/[\\/]/).some(part => /^(?:\.env(?:\.|$)|credentials(?:\.|$)|id_rsa(?:\.|$)|id_ed25519(?:\.|$))/i.test(part))) {
    throw new Error(FAILURE);
  }
  return path.resolve(value);
}

async function verifiedParent(file) {
  const directory = path.dirname(file);
  if (await fs.realpath(directory) !== directory) throw new Error(FAILURE);
  return directory;
}

async function readDataset(input) {
  const file = jsonPath(input);
  await verifiedParent(file);
  // Validate the opened descriptor, not a pathname snapshot. Nonblocking open
  // prevents a substituted FIFO from waiting for a writer before validation.
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BYTES) throw new Error(FAILURE);
    // Bound allocation even if another process grows the file after stat.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length > MAX_BYTES || length !== before.size || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(FAILURE);
    const bytes = buffer.subarray(0, length);
    return { dataset: JSON.parse(bytes.toString('utf8')), inputSha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { await handle.close(); }
}

/** Offline only. Nothing is collected, uploaded, or read from browser storage. */
export async function analyzePilotFile({ input, output, asOf, localBrowserExport = false } = {}) {
  try {
    if (typeof asOf !== 'string' || typeof localBrowserExport !== 'boolean') throw new Error(FAILURE);
    const target = jsonPath(output);
    await verifiedParent(target);
    const { dataset, inputSha256 } = await readDataset(input);
    const summarize = localBrowserExport ? summarizeLocalMealPlanPilotExport : summarizeMealPlanPilot;
    const report = { ...summarize(dataset, { asOf }), inputSha256 };
    // Exclusive creation also rejects an existing symlink; no report is replaced.
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8'); }
    finally { await handle.close(); }
    return report;
  } catch {
    // Never print parse excerpts, filesystem paths or caller-supplied payloads.
    throw new Error(FAILURE);
  }
}

function argumentsToOptions(args) {
  const options = {};
  const namedOptions = { '--input': 'input', '--output': 'output', '--as-of': 'asOf' };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--local-browser-export') {
      if (Object.hasOwn(options, 'localBrowserExport')) throw new Error(FAILURE);
      options.localBrowserExport = true;
      continue;
    }
    if (!Object.hasOwn(namedOptions, args[index])) throw new Error(FAILURE);
    const key = namedOptions[args[index]];
    if (!key || Object.hasOwn(options, key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(FAILURE);
    options[key] = args[index + 1];
    index += 1;
  }
  if (!options.input || !options.output || !options.asOf) throw new Error(FAILURE);
  return options;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Offline pilot metrics (no collection or upload).\nnode scripts/analyze-meal-plan-pilot.mjs --input FILE.json --output NEW.json --as-of UTC_ISO_TIMESTAMP [--local-browser-export]\nThe explicit local mode counts browser scopes, not unique accounts.');
    return;
  }
  const report = await analyzePilotFile(argumentsToOptions(args));
  const population = report.measurementUnit === 'browser-scope' ? 'browserScopes' : 'subjects';
  console.log(`Pilot metrics written. ${population}=${report.counts.subjects} events=${report.counts.uniqueEvents}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error(FAILURE); process.exitCode = 1; });
}
