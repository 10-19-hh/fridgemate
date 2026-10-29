import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import viteConfig from '../../vite.config.js';
import { PUBLIC_ROUTES, getRouteMetadata } from '../../src/utils/routeMetadata.js';
import { PUBLIC_RECIPE_PATHS } from '../../src/features/recipes/publicRecipeCatalog.js';

const entryPoints = {
  ...import.meta.glob('../lib/localPilotBuild.js'),
  ...import.meta.glob('../build-local-pilot.mjs'),
  ...import.meta.glob('../prepare-pilot-preview.mjs')
};
let fixture;

async function entry(name, file = '../lib/localPilotBuild.js') {
  const module = await entryPoints[file]?.();
  expect(module?.[name], `public offline entry point ${name}`).toBeTypeOf('function');
  return module[name];
}

beforeEach(async () => {
  fixture = await realpath(await mkdtemp(join(tmpdir(), 'fridgemate-pilot-build-test-')));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(fixture, { recursive: true, force: true });
});

describe('pilot Vite build boundary', () => {
  function configure() {
    vi.spyOn(process, 'cwd').mockReturnValue(fixture);
    return viteConfig({ mode: 'production' });
  }

  it('writes pilot output separately and disables dotenv input', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    const config = configure();
    expect(config.build?.outDir).toBe('dist-pilot');
    expect(config.envDir).toBe(false);
  });

  it('rejects a dotenv-only pilot flag and directs callers to the isolated build command', async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', undefined);
    await writeFile(join(fixture, '.env'), 'VITE_LOCAL_PILOT_ENABLED=" TRUE "\n');
    expect(configure).toThrow(/npm run build:pilot/);
  });

  it.each(['VERCEL_ENV', 'VERCEL_TARGET_ENV'])('rejects a pilot in the %s production target', key => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    vi.stubEnv(key, 'production');
    expect(configure).toThrow(/production/i);
  });

  it('leaves ordinary production builds on the existing output and dotenv behavior', () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    vi.stubEnv('VERCEL_ENV', 'production');
    const config = configure();
    expect(config.build?.outDir ?? 'dist').toBe('dist');
    expect(config.envDir).not.toBe(false);
  });
});

describe('local pilot build preparation', () => {
  it('keeps only build prerequisites and fixes every remote switch without mutating the input', async () => {
    const environment = await entry('createPilotBuildEnvironment');
    const inherited = { PATH: '/fixture/bin', CI: 'true', VERCEL_ENV: 'preview',
      VITE_API_URL: 'https://synthetic.invalid/api', VITE_API_URL_OVERRIDE: 'https://override.invalid',
      VITE_API_BASE_URL: 'https://alias.invalid', VITE_SENTRY_DSN: 'fixture-dsn',
      VITE_GA_MEASUREMENT_ID: 'G-FIXTURE', VITE_ADSENSE_ENABLED: 'true',
      VITE_LOCAL_PILOT_ENABLED: 'false', OPENAI_API_KEY: 'fixture-not-a-key',
      DATABASE_URL: 'fixture-not-a-database', NODE_OPTIONS: '--require fixture.cjs' };
    const original = { ...inherited };
    const result = environment(inherited);
    expect(result).toMatchObject({ PATH: '/fixture/bin', CI: 'true', VERCEL_ENV: 'preview',
      VITE_LOCAL_PILOT_ENABLED: 'true', VITE_API_URL: '', VITE_API_URL_OVERRIDE: '', VITE_API_BASE_URL: '',
      VITE_SENTRY_DSN: '', VITE_GA_MEASUREMENT_ID: '', VITE_ADSENSE_ENABLED: 'false',
      VITE_ADSENSE_VERIFICATION_ENABLED: 'false', VITE_ADSENSE_SERVING_ENABLED: 'false',
      VITE_ENABLE_EXTERNAL_AI_DATA_PROCESSING: 'false', VITE_ENABLE_REMOTE_IMPORT_LEARNING: 'false' });
    for (const key of ['OPENAI_API_KEY', 'DATABASE_URL', 'NODE_OPTIONS']) expect(result).not.toHaveProperty(key);
    expect(inherited).toEqual(original);
  });

  it.each(['VERCEL_ENV', 'VERCEL_TARGET_ENV'])('refuses %s=production before starting a build', async key => {
    const build = await entry('buildLocalPilot', '../build-local-pilot.mjs');
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ scripts: {
      build: 'node -e "require(\'fs\').mkdirSync(\'dist-pilot\')"'
    } }));
    await expect(build({ cwd: fixture, env: { PATH: process.env.PATH, [key]: ' Production ' } }))
      .rejects.toThrow(/production/i);
    await expect(access(join(fixture, 'dist-pilot'))).rejects.toThrow();
  });

  it('runs the real package build and postbuild with isolated env and preserves the ordinary artifact', async () => {
    const build = await entry('buildLocalPilot', '../build-local-pilot.mjs');
    await mkdir(join(fixture, 'dist'));
    await writeFile(join(fixture, 'dist', 'existing.txt'), 'ordinary build');
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ scripts: {
      build: 'node build.cjs', postbuild: 'node postbuild.cjs'
    } }));
    await writeFile(join(fixture, 'build.cjs'), `
      const fs = require('node:fs');
      fs.mkdirSync('dist-pilot');
      fs.writeFileSync('dist-pilot/index.html', '<h1>Pilot fixture</h1>');
      fs.writeFileSync('dist-pilot/env.json', JSON.stringify({ pilot: process.env.VITE_LOCAL_PILOT_ENABLED,
        api: process.env.VITE_API_URL, sentry: process.env.VITE_SENTRY_DSN,
        secretInherited: Boolean(process.env.OPENAI_API_KEY) }));
    `);
    await writeFile(join(fixture, 'postbuild.cjs'), "require('node:fs').writeFileSync('dist-pilot/postbuild.txt', 'complete');");
    await build({ cwd: fixture, env: { PATH: process.env.PATH, TMPDIR: tmpdir(),
      VITE_API_URL: 'https://synthetic.invalid/api', OPENAI_API_KEY: 'fixture-not-a-key' } });
    expect(JSON.parse(await readFile(join(fixture, 'dist-pilot/env.json'), 'utf8')))
      .toEqual({ pilot: 'true', api: '', sentry: '', secretInherited: false });
    expect(await readFile(join(fixture, 'dist-pilot/postbuild.txt'), 'utf8')).toBe('complete');
    expect(await readFile(join(fixture, 'dist/existing.txt'), 'utf8')).toBe('ordinary build');
  });

  it('reports a failed build instead of continuing to postbuild', async () => {
    const build = await entry('buildLocalPilot', '../build-local-pilot.mjs');
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ scripts: {
      build: 'node -e "process.exit(7)"', postbuild: 'node -e "require(\'fs\').writeFileSync(\'unexpected\', \'bad\')"'
    } }));
    await expect(build({ cwd: fixture, env: { PATH: process.env.PATH } })).rejects.toThrow(/build/i);
    await expect(access(join(fixture, 'unexpected'))).rejects.toThrow();
  });
});

describe('standalone Preview configuration artifact', () => {
  async function prepareFixture() {
    const prepare = await entry('preparePilotPreview', '../prepare-pilot-preview.mjs');
    const original = { buildCommand: 'npm run build', outputDirectory: 'dist',
      redirects: [{ source: '/:path*', destination: 'https://synthetic.invalid/:path*', permanent: true }],
      rewrites: [{ source: '/pilot', destination: '/_seo/app.html' }],
      headers: [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "connect-src https://synthetic.invalid" }] }] };
    await writeFile(join(fixture, 'vercel.json'), JSON.stringify(original));
    return { prepare, original };
  }

  it('writes no production redirect and emits a noindex same-origin network policy without touching the source', async () => {
    const { prepare, original } = await prepareFixture();
    const output = join(fixture, 'preview.json');
    await prepare({ root: fixture, output });
    const config = JSON.parse(await readFile(output, 'utf8'));
    expect(config).toMatchObject({ buildCommand: 'npm run build:pilot', outputDirectory: 'dist-pilot', redirects: [],
      rewrites: [{ source: '/pilot', destination: '/_seo/app.html' }] });
    const globalHeaders = config.headers.filter(rule => rule.source === '/(.*)').flatMap(rule => rule.headers);
    expect(globalHeaders).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' });
    const csp = globalHeaders.find(header => header.key.toLowerCase() === 'content-security-policy').value;
    expect(csp.split(';').map(value => value.trim())).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/synthetic\.invalid|google-analytics|googletagmanager|sentry\.io/);
    expect(JSON.parse(await readFile(join(fixture, 'vercel.json'), 'utf8'))).toEqual(original);
  });

  it('refuses to overwrite an existing output', async () => {
    const { prepare } = await prepareFixture();
    const output = join(fixture, 'preview.json');
    await writeFile(output, 'existing evidence');
    await expect(prepare({ root: fixture, output })).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('existing evidence');
  });

  it.each(['https://synthetic.invalid/api', '//synthetic.invalid/api'])('rejects a server proxy rewrite to %s', async destination => {
    const { prepare } = await prepareFixture();
    await writeFile(join(fixture, 'vercel.json'), JSON.stringify({ rewrites: [{ source: '/api/:path*', destination }] }));
    const output = join(fixture, 'preview.json');
    await expect(prepare({ root: fixture, output })).rejects.toThrow(/static/i);
    await expect(access(output)).rejects.toThrow();
  });
});

describe('SEO verification of the cloud-selected pilot Preview configuration', () => {
  const projectConfigPath = resolve('vercel.json');
  const verifierPath = resolve('scripts/verify-seo-output.js');
  const privatePaths = ['/account', '/import', '/ingredients', '/login', '/signup', '/meal-plan', '/pilot'];

  async function prepareCloudFixture() {
    const projectConfigBefore = await readFile(projectConfigPath, 'utf8');
    const sourceConfigPath = join(fixture, 'vercel.json');
    const generatedConfigPath = join(fixture, 'preview.json');
    await writeFile(sourceConfigPath, projectConfigBefore);
    const prepare = await entry('preparePilotPreview', '../prepare-pilot-preview.mjs');
    await prepare({ root: fixture, output: generatedConfigPath });
    const generatedConfigBefore = await readFile(generatedConfigPath, 'utf8');
    const cloudRoot = join(fixture, 'cloud');
    const output = join(cloudRoot, 'dist-pilot');

    // Synthetic HTML isolates the hosting-header contract. This is not a
    // recipe/content audit, and no Vite/OCR build or remote request is run.
    await Promise.all(PUBLIC_ROUTES.map(async pathname => {
      const metadata = getRouteMetadata(pathname);
      const filename = pathname === '/' ? 'index.html' : `_seo${pathname}.html`;
      const destination = join(output, filename);
      await mkdir(dirname(destination), { recursive: true });
      const structuredData = metadata.recipe
        ? { '@type': 'Recipe', recipeYield: 1, keywords: 'synthetic header fixture' }
        : { '@type': 'WebPage' };
      const recipeLinks = pathname === '/recipes'
        ? PUBLIC_RECIPE_PATHS.map(path => `<a href="${path}">Fixture recipe</a>`).join('') : '';
      await writeFile(destination, `<!doctype html><html><head><title>${metadata.title}</title>
        <link rel="canonical" href="${metadata.canonical}"><meta name="robots" content="index,follow">
        <script type="application/ld+json">${JSON.stringify(structuredData)}</script></head>
        <body><div id="root"><!--seo-prerender-start--><h1>SEO header fixture</h1>${recipeLinks}<!--seo-prerender-end--></div></body></html>`);
    }));
    await writeFile(join(output, 'sitemap.xml'), `<urlset>${PUBLIC_ROUTES.map(pathname =>
      `<url><loc>${getRouteMetadata(pathname).canonical.replaceAll('&', '&amp;')}</loc></url>`).join('')}</urlset>`);
    await writeFile(join(output, 'robots.txt'), `User-agent: *\n${privatePaths.map(path => `Disallow: ${path}`).join('\n')}\n`);
    await writeFile(join(output, '_seo/app.html'), '<!doctype html><html><head><meta name="robots" content="noindex,nofollow,noarchive"></head><body><div id="root"></div></body></html>');

    async function run(config) {
      await writeFile(join(cloudRoot, 'vercel.json'), JSON.stringify(config));
      const result = spawnSync(process.execPath, [verifierPath], {
        cwd: cloudRoot, shell: false, encoding: 'utf8', timeout: 10000,
        env: { PATH: process.env.PATH, VITE_LOCAL_PILOT_ENABLED: 'true' },
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(await readFile(projectConfigPath, 'utf8')).toBe(projectConfigBefore);
      expect(await readFile(sourceConfigPath, 'utf8')).toBe(projectConfigBefore);
      expect(await readFile(generatedConfigPath, 'utf8')).toBe(generatedConfigBefore);
      return result;
    }
    return { run, generated: JSON.parse(generatedConfigBefore), source: JSON.parse(projectConfigBefore) };
  }

  it('accepts the generated global noindex policy when Preview selects it as vercel.json', async () => {
    const { run, generated } = await prepareCloudFixture();
    const result = await run(generated);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Verified SEO output for 113 public routes');
  });

  it('keeps accepting the existing exact private-path response headers', async () => {
    const { run, source } = await prepareCloudFixture();
    const result = await run(source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Verified SEO output for 113 public routes');
  });

  it.each([
    ['unrelated path', '/public/(.*)', 'noindex, nofollow, noarchive'],
    ['missing noarchive directive', '/(.*)', 'noindex, nofollow'],
  ])('rejects a purported global policy with %s', async (_name, source, value) => {
    const { run, generated } = await prepareCloudFixture();
    const result = await run({ ...generated, headers: [
      { source, headers: [{ key: 'X-Robots-Tag', value }] },
    ] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/account is missing its private-page response header');
  });
});
