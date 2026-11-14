// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

// These are the browser loader's selectable core variants, including both OEM
// families. Check emitted files, not the copy script's private list or log count.
const coreFiles = [
  'tesseract-core.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js'
];

it.each([
  ['ordinary', 'dist', {}],
  ['pilot', 'dist-pilot', { VITE_LOCAL_PILOT_ENABLED: 'true' }]
])('ships every selectable OCR core and its worker/languages in the %s build', async (_mode, output, env) => {
  const fixture = await mkdtemp(join(tmpdir(), 'fridgemate-ocr-assets-'));
  fixtures.push(fixture);
  for (const file of ['scripts/copy-tesseract-assets.js', 'scripts/lib/localPilotBuild.js', 'src/utils/pilotMode.js']) {
    await mkdir(dirname(join(fixture, file)), { recursive: true });
    await copyFile(join(root, file), join(fixture, file));
  }
  await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
  await symlink(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  execFileSync(process.execPath, ['scripts/copy-tesseract-assets.js'], {
    cwd: fixture,
    env,
    stdio: 'pipe'
  });
  const emitted = join(fixture, output, 'ocr/tesseract');
  expect(await readdir(join(emitted, 'core'))).toEqual(expect.arrayContaining(coreFiles));
  const assets = [
    ...coreFiles.map(file => [`tesseract.js-core/${file}`, `core/${file}`]),
    ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz', 'lang/kor.traineddata.gz'],
    ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz']
  ];
  for (const [source, destination] of assets) {
    const original = await readFile(join(root, 'node_modules', source));
    const published = await readFile(join(emitted, destination));
    expect(published.length, destination).toBeGreaterThan(0);
    expect(published.equals(original), destination).toBe(true);
  }
}, 15000);
