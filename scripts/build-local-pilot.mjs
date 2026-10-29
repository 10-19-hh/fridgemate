import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { createPilotBuildEnvironment } from './lib/localPilotBuild.js';

export async function buildLocalPilot({ cwd = process.cwd(), env = process.env } = {}) {
  const buildEnv = createPilotBuildEnvironment(env);
  await new Promise((resolveBuild, reject) => {
    const child = spawn('npm', ['run', 'build'], { cwd, env: buildEnv, shell: false, stdio: 'inherit' });
    child.on('error', () => reject(new Error('The local pilot build could not start.')));
    child.on('close', code => code === 0 ? resolveBuild() : reject(new Error('The local pilot build failed.')));
  });
  return { outputDirectory: resolve(cwd, 'dist-pilot') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => {
    if (process.argv.length !== 2) throw new Error('The pilot build takes no command arguments.');
    return buildLocalPilot();
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
