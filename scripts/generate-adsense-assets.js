import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { getAdSenseConfig, isValidAdSenseClient } from '../src/utils/adsenseConfig.js';
import { isLocalPilotBuild } from '../src/utils/pilotMode.js';
import { getBuildOutputDirectory } from './lib/localPilotBuild.js';

const productionEnv = isLocalPilotBuild(process.env) ? {} : loadEnv('production', process.cwd(), 'VITE_');
const config = getAdSenseConfig({ ...productionEnv, ...process.env });

if (config.requested && !isValidAdSenseClient(config.client)) {
  throw new Error(
    'VITE_ADSENSE_CLIENT must use the ca-pub-XXXXXXXXXXXXXXXX format when AdSense verification is enabled.'
  );
}

if (config.verificationEnabled) {
  const outputDirectory = resolve(process.cwd(), getBuildOutputDirectory());
  const publisherId = config.client.replace(/^ca-/, '');
  const content = `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`;

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'ads.txt'), content, 'utf8');
  console.log('Generated dist/ads.txt for the configured AdSense publisher.');
} else {
  console.log('AdSense site verification is disabled; dist/ads.txt was not generated.');
}
