import { open, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { createPilotVercelConfig } from './lib/localPilotBuild.js';

export async function preparePilotPreview({ root = process.cwd(), output } = {}) {
  if (typeof output !== 'string' || extname(output) !== '.json') throw new Error('A new JSON output path is required.');
  const target = resolve(output);
  const parent = dirname(target);
  if (await realpath(parent) !== parent) throw new Error('The output parent must not be a symlink.');
  const source = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
  const config = createPilotVercelConfig(source);
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8'); }
  finally { await handle.close(); }
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => {
    const [flag, output, ...extra] = process.argv.slice(2);
    if (flag !== '--output' || !output || extra.length) throw new Error('Use --output with a new JSON path.');
    return preparePilotPreview({ output });
  }).then(() => console.log('Prepared a separate Preview-only config. No deployment or Git configuration was changed.'))
    .catch(() => { console.error('Preview config preparation failed. Use a new JSON path with an existing regular parent.'); process.exitCode = 1; });
}
