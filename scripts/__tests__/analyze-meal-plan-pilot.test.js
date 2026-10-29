// @vitest-environment node
import { mkdtemp, readFile, writeFile, stat, lstat, symlink, link, mkdir, access, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

const folders = [];
const AS_OF = '2026-09-20T15:00:00.000Z';
const PRIVATE = 'PRIVATE_INPUT_MUST_NEVER_BE_ECHOED';
const dataset = () => ({ schemaVersion: 1, exportedAt: AS_OF, subjects: [{
  id: 'sub_00000000000000000000000000000001', kind: 'guest',
  observedFrom: '2026-09-06T15:00:00.000Z', observedThrough: AS_OF,
  firstGenerationKnown: true, gaps: [],
}], events: [] });

const localEnvelope = () => {
  const data = dataset();
  data.subjects[0].kind = 'account';
  data.subjects[0].firstGenerationKnown = false;
  return { schemaVersion: 1, exportKind: 'fridgemate-local-meal-plan-pilot', measurementUnit: 'browser-scope',
    policyVersion: 'local-pilot-35d-v1', startedAt: '2026-09-06T15:00:00.000Z',
    expiresAt: '2026-10-11T15:00:00.000Z', dataset: data };
};

async function runner() {
  const load = import.meta.glob('../analyze-meal-plan-pilot.mjs')['../analyze-meal-plan-pilot.mjs'];
  const api = load ? await load() : {};
  expect(api.analyzePilotFile, 'the offline analysis entry point is implemented').toBeTypeOf('function');
  return api.analyzePilotFile;
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'fridgemate-pilot-cli-test-')));
  folders.push(directory);
  const input = join(directory, 'synthetic.json');
  const output = join(directory, 'summary.json');
  await writeFile(input, JSON.stringify(dataset()));
  return { directory, input, output, asOf: AS_OF };
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('explicit local-browser export analysis mode', () => {
  it('analyzes an actual local export file with browser-only labels and leaves input intact', async () => {
    const analyze = await runner(); const args = await fixture();
    await writeFile(args.input, JSON.stringify(localEnvelope()));
    const original = await readFile(args.input);
    const result = await analyze({ ...args, localBrowserExport: true });
    const stored = JSON.parse(await readFile(args.output, 'utf8'));
    expect(stored).toEqual(result);
    expect(stored).toMatchObject({ measurementUnit: 'browser-scope', actualAccountKpisAvailable: false,
      counts: { subjects: 1, noEventSubjects: 1 },
      activation: { signedInBrowser: { unknownFirst: 1, eligible: 0, rate: null }, guestBrowser: { unknownFirst: 0 } } });
    expect(stored.activation).not.toHaveProperty('account');
    expect(await readFile(args.input)).toEqual(original);
    expect((await stat(args.output)).mode & 0o777).toBe(0o600);
  });

  it.each([
    ['local envelope in ordinary mode', localEnvelope, false],
    ['prepared dataset in local mode', dataset, true],
  ])('rejects %s instead of silently reinterpreting identity', async (_name, build, localBrowserExport) => {
    const analyze = await runner(); const args = await fixture();
    await writeFile(args.input, JSON.stringify(build()));
    await expect(analyze({ ...args, localBrowserExport })).rejects.toThrow();
    await expect(access(args.output)).rejects.toThrow();
  });

  it('rejects a truthy string instead of silently selecting a mode', async () => {
    const analyze = await runner(); const args = await fixture();
    await expect(analyze({ ...args, localBrowserExport: 'false' })).rejects.toThrow();
    await expect(access(args.output)).rejects.toThrow();
  });

  it('does not replace a local-mode report or reflect a private envelope field', async () => {
    const analyze = await runner(); const args = await fixture();
    await writeFile(args.input, JSON.stringify(localEnvelope()));
    await writeFile(args.output, 'KEEP_EXISTING');
    await expect(analyze({ ...args, localBrowserExport: true })).rejects.toThrow();
    expect(await readFile(args.output, 'utf8')).toBe('KEEP_EXISTING');
    await writeFile(args.input, JSON.stringify({ ...localEnvelope(), originalAccountId: PRIVATE }));
    const newOutput = join(args.directory, 'new.json');
    let failure;
    try { await analyze({ ...args, output: newOutput, localBrowserExport: true }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).not.toContain(PRIVATE);
    await expect(access(newOutput)).rejects.toThrow();
  });

  it('requires the explicit CLI flag in any position and rejects duplicate flags or mode mixing', async () => {
    await runner(); const args = await fixture();
    await writeFile(args.input, JSON.stringify(localEnvelope()));
    const entry = resolve('scripts/analyze-meal-plan-pilot.mjs');
    const run = argv => spawnSync(process.execPath, [entry, ...argv], { encoding: 'utf8', timeout: 10000 });
    const base = output => ['--input', args.input, '--output', output, '--as-of', AS_OF];
    const first = run(['--local-browser-export', ...base(args.output)]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('browserScopes=1');
    expect(first.stdout).not.toMatch(/accounts=|sub_/);
    expect(JSON.parse(await readFile(args.output, 'utf8')).actualAccountKpisAvailable).toBe(false);
    const trailing = join(args.directory, 'trailing.json');
    expect(run([...base(trailing), '--local-browser-export']).status).toBe(0);
    for (const argv of [base(join(args.directory, 'wrong.json')),
      ['--local-browser-export', '--local-browser-export', ...base(join(args.directory, 'double.json'))],
      ['--local-browser-export', 'true', ...base(join(args.directory, 'value.json'))]]) {
      expect(run(argv).status).toBe(1);
    }
    await writeFile(args.input, JSON.stringify(dataset()));
    const wrongMode = run(['--local-browser-export', ...base(join(args.directory, 'prepared.json'))]);
    expect(wrongMode.status).toBe(1);
    await expect(access(join(args.directory, 'prepared.json'))).rejects.toThrow();
  });

  it.each(['constructor', '__proto__', 'toString'])('rejects inherited object key %s as an unrecognized CLI argument', async key => {
    await runner(); const args = await fixture();
    const result = spawnSync(process.execPath, [resolve('scripts/analyze-meal-plan-pilot.mjs'),
      '--input', args.input, '--output', args.output, '--as-of', AS_OF, key, PRIVATE],
    { encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(PRIVATE);
    await expect(access(args.output)).rejects.toThrow();
  });
});

describe('offline meal-plan pilot analysis files', () => {
  it('analyzes the checked synthetic cohort without dropping a participant with missing next-week observation', async () => {
    const analyze = await runner(); const args = await fixture();
    const input = await realpath(resolve('scripts/fixtures/meal-plan-pilot.synthetic.json'));
    const report = await analyze({ ...args, input, asOf: '2026-09-21T00:00:00.000Z' });
    expect(report.counts).toMatchObject({ subjects: 3, inputEvents: 17, uniqueEvents: 17 });
    expect(report.weekly.find(week => week.weekKey === '2026-09-07')).toMatchObject({
      account: { activeSubjects: 2 }, guest: { activeSubjects: 1 } });
    expect(report.retention.find(week => week.weekKey === '2026-09-07')).toMatchObject({
      account: { eligible: 2, retainedObserved: 1, missingObservation: 1, observedInactive: 0, rate: 0.5 },
      guest: { eligible: 1, retainedObserved: 0, missingObservation: 0, observedInactive: 1, rate: 0 } });
    expect(report.activation).toMatchObject({ account: { eligible: 1, activated: 1, unknownFirst: 1, rate: 1 },
      guest: { eligible: 1, activated: 0, rate: 0 } });
    expect(report.decisionTime).toMatchObject({ account: { measured: 1, medianWallTimeMs: 120000 },
      guest: { measured: 1, medianWallTimeMs: 259320000 } });
  });

  it('writes an aggregate-only reproducible report to a private new file without changing input', async () => {
    const analyze = await runner(); const args = await fixture();
    const original = await readFile(args.input);
    const result = await analyze(args);
    const stored = JSON.parse(await readFile(args.output, 'utf8'));
    expect(stored).toEqual(result);
    expect(stored).toMatchObject({ asOf: AS_OF, timeZone: 'Asia/Seoul',
      inputSha256: createHash('sha256').update(original).digest('hex'),
      counts: { subjects: 1, inputEvents: 0, uniqueEvents: 0, noEventSubjects: 1 },
      activation: { guest: { eligible: 0, activated: 0, rate: null } } });
    expect(JSON.stringify(stored)).not.toContain(dataset().subjects[0].id);
    expect(JSON.stringify(stored)).not.toContain(args.directory);
    expect((await stat(args.output)).mode & 0o777).toBe(0o600);
    expect(await readFile(args.input)).toEqual(original);
  });

  it('never replaces an existing report or its contents', async () => {
    const analyze = await runner(); const args = await fixture();
    await writeFile(args.output, 'previous report');
    await expect(analyze(args)).rejects.toThrow();
    expect(await readFile(args.output, 'utf8')).toBe('previous report');
  });

  it.each(['input', 'output'])('rejects a %s symlink without touching its target', async role => {
    const analyze = await runner(); const args = await fixture();
    const target = join(args.directory, 'target.json');
    const original = role === 'input' ? JSON.stringify(dataset()) : 'keep private target';
    await writeFile(target, original);
    const linked = join(args.directory, 'linked.json');
    await symlink(target, linked);
    await expect(analyze({ ...args, [role]: linked })).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe(original);
    if (role === 'input') await expect(access(args.output)).rejects.toThrow();
  });

  it('rejects a hard-linked source', async () => {
    const analyze = await runner(); const args = await fixture();
    const linked = join(args.directory, 'linked.json');
    await link(args.input, linked);
    await expect(analyze({ ...args, input: linked })).rejects.toThrow();
    await expect(access(args.output)).rejects.toThrow();
  });

  it('rejects an input replaced with a FIFO at open without waiting for a writer', async () => {
    const args = await fixture();
    // Keep the real filesystem and analysis code. A child bounds the broken
    // blocking open; only the race timing at its syscall boundary is injected.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs/promises';
      import { execFileSync } from 'node:child_process';
      import { pathToFileURL } from 'node:url';
      const [serialized, entry] = process.argv.slice(1);
      const args = JSON.parse(serialized);
      const open = fs.open.bind(fs);
      fs.open = async (file, ...options) => {
        if (file === args.input) {
          await fs.unlink(file);
          execFileSync('mkfifo', [file]);
          console.log('fifo-ready');
        }
        return open(file, ...options);
      };
      const { analyzePilotFile } = await import(pathToFileURL(entry).href);
      try {
        await analyzePilotFile(args);
        console.log('unexpected-success');
        process.exitCode = 2;
      } catch (error) {
        console.log(JSON.stringify({ outcome: 'rejected', message: error.message }));
      }
    `, JSON.stringify(args), resolve('scripts/analyze-meal-plan-pilot.mjs')],
    { encoding: 'utf8', timeout: 3000 });

    expect(result.stdout).toContain('fifo-ready');
    expect((await lstat(args.input)).isFIFO()).toBe(true);
    await expect(access(args.output)).rejects.toThrow();
    expect(result.error?.code).not.toBe('ETIMEDOUT');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"outcome":"rejected"');
    expect(result.stdout + result.stderr).not.toContain(args.input);
  });

  it.each(['input', 'output'])('rejects a symlinked parent for %s', async role => {
    const analyze = await runner(); const args = await fixture();
    const nested = join(args.directory, 'nested'); await mkdir(nested);
    const linked = join(args.directory, 'parent-link'); await symlink(nested, linked);
    if (role === 'input') await writeFile(join(nested, 'source.json'), JSON.stringify(dataset()));
    await expect(analyze({ ...args, [role]: join(linked, role === 'input' ? 'source.json' : 'report.json') })).rejects.toThrow();
    await expect(access(join(nested, 'report.json'))).rejects.toThrow();
  });

  it.each(['.env.json', 'credentials.json', 'id_rsa.json', 'data.txt'])('does not read a prohibited source filename %s', async name => {
    const analyze = await runner(); const args = await fixture();
    const input = join(args.directory, name); await writeFile(input, PRIVATE);
    await expect(analyze({ ...args, input })).rejects.toThrow();
    await expect(access(args.output)).rejects.toThrow();
  });

  it('does not echo malformed JSON or unknown private fields and writes no report', async () => {
    const analyze = await runner(); const args = await fixture();
    for (const body of [PRIVATE, JSON.stringify({ ...dataset(), inventory: PRIVATE })]) {
      await writeFile(args.input, body);
      let failure;
      try { await analyze(args); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).not.toContain(PRIVATE);
      expect(failure.message).not.toContain(args.input);
      await expect(access(args.output)).rejects.toThrow();
    }
  });

  it('rejects an oversized file before parsing it', async () => {
    const analyze = await runner(); const args = await fixture();
    await writeFile(args.input, ' '.repeat(12 * 1024 * 1024 + 1));
    await expect(analyze(args)).rejects.toThrow();
    await expect(access(args.output)).rejects.toThrow();
  });

  it('requires an explicit valid cutoff and does not default to the machine clock', async () => {
    const analyze = await runner(); const args = await fixture();
    for (const asOf of [undefined, '2026-02-30T00:00:00.000Z', '2026-09-21T00:00:00.000Z']) {
      await expect(analyze({ ...args, asOf })).rejects.toThrow();
      await expect(access(args.output)).rejects.toThrow();
    }
  });

  it('runs the actual CLI, reports a small summary, and rejects unknown or duplicate arguments', async () => {
    await runner(); const args = await fixture();
    const entry = resolve('scripts/analyze-meal-plan-pilot.mjs');
    const run = argv => spawnSync(process.execPath, [entry, ...argv], { encoding: 'utf8', timeout: 10000 });
    const help = run(['--help']); expect(help.status).toBe(0); expect(help.stdout).toContain('--as-of');
    const success = run(['--input', args.input, '--output', args.output, '--as-of', AS_OF]);
    expect(success.status).toBe(0); expect(success.stdout).toContain('subjects=1');
    expect(success.stdout).not.toContain(dataset().subjects[0].id);
    const original = await readFile(args.output);
    for (const argv of [['--unknown', PRIVATE], ['--input', args.input], ['--input', args.input, '--input', args.input,
      '--output', args.output, '--as-of', AS_OF]]) {
      const failed = run(argv); expect(failed.status).toBe(1);
      expect(failed.stdout + failed.stderr).not.toContain(PRIVATE);
      expect(await readFile(args.output)).toEqual(original);
    }
  });
});
