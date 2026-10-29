import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBuildOutputDirectory } from './lib/localPilotBuild.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(projectRoot, getBuildOutputDirectory(), 'ocr', 'tesseract');

const assetCopies = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'core/tesseract-core.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd.wasm.js', 'core/tesseract-core-simd.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'core/tesseract-core-simd-lstm.wasm.js'
  ],
  [
    'node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz',
    'lang/kor.traineddata.gz'
  ],
  [
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    'lang/eng.traineddata.gz'
  ]
];

for (const [sourcePath, destinationPath] of assetCopies) {
  const absoluteDestination = join(outputRoot, destinationPath);
  await mkdir(dirname(absoluteDestination), { recursive: true });
  await copyFile(join(projectRoot, sourcePath), absoluteDestination);
}

console.log(`[build] Copied ${assetCopies.length} same-origin Tesseract assets.`);
