import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';
import { cleanGeneratedSeo, removeCanonicalLinks } from './lib/seoHtmlSecurity.js';
import { getBuildOutputDirectory } from './lib/localPilotBuild.js';

const outputDirectory = resolve(process.cwd(), getBuildOutputDirectory());
const templatePath = resolve(outputDirectory, 'index.html');

const routeOutputFiles = {
  '/': 'index.html',
  '/recipes': '_seo/recipes.html',
  '/about': '_seo/about.html',
  '/contact': '_seo/contact.html',
  '/privacy': '_seo/privacy.html'
};

function getRouteOutputFile(pathname) {
  if (routeOutputFiles[pathname]) return routeOutputFiles[pathname];
  if (pathname.startsWith('/recipes/')) return `_seo${pathname}.html`;
  if (pathname.startsWith('/guides/')) return `_seo${pathname}.html`;
  return '';
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function setTagAttribute(html, tagPattern, attribute, value) {
  return html.replace(tagPattern, (tag) => {
    const escapedValue = escapeAttribute(value);
    const attributePattern = new RegExp(`\\s${attribute}=(?:"[^"]*"|'[^']*')`, 'i');

    if (attributePattern.test(tag)) {
      return tag.replace(attributePattern, ` ${attribute}="${escapedValue}"`);
    }

    return tag.replace(/\s*\/>$|>$/, (ending) => ` ${attribute}="${escapedValue}"${ending}`);
  });
}

function appendHeadTags(html, tags) {
  return html.replace('</head>', `${tags}\n  </head>`);
}

function applyMetadata(html, metadata) {
  let nextHtml = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttribute(metadata.title)}</title>`);

  nextHtml = setTagAttribute(
    nextHtml,
    /<meta[^>]+name=["']description["'][^>]*>/i,
    'content',
    metadata.description
  );
  nextHtml = setTagAttribute(
    nextHtml,
    /<meta[^>]+name=["']robots["'][^>]*>/i,
    'content',
    metadata.indexable ? 'index,follow' : 'noindex,nofollow,noarchive'
  );
  nextHtml = setTagAttribute(nextHtml, /<meta[^>]+property=["']og:title["'][^>]*>/i, 'content', metadata.title);
  nextHtml = setTagAttribute(
    nextHtml,
    /<meta[^>]+property=["']og:description["'][^>]*>/i,
    'content',
    metadata.description
  );
  nextHtml = setTagAttribute(nextHtml, /<meta[^>]+property=["']og:url["'][^>]*>/i, 'content', metadata.canonical);
  nextHtml = setTagAttribute(nextHtml, /<link[^>]+rel=["']canonical["'][^>]*>/i, 'href', metadata.canonical);

  return nextHtml;
}

function structuredDataTags(schemas) {
  return schemas
    .map((schema) => {
      const json = JSON.stringify(schema).replaceAll('<', '\\u003c');
      return `    <script type="application/ld+json" data-seo-structured-data>${json}</script>`;
    })
    .join('\n');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildSitemap(routes, getRouteMetadata) {
  const urls = routes
    .map((pathname) => `  <url>\n    <loc>${escapeXml(getRouteMetadata(pathname).canonical)}</loc>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function renderPublicDocument(template, markup, metadata, schemas) {
  let html = applyMetadata(template, metadata);
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root"><!--seo-prerender-start-->${markup}<!--seo-prerender-end--></div>`
  );

  const extraTags = [
    '    <meta property="og:locale" content="ko_KR" data-seo-generated />',
    '    <meta property="og:site_name" content="오늘뭐먹지" data-seo-generated />',
    '    <meta name="twitter:card" content="summary" data-seo-generated />',
    structuredDataTags(schemas)
  ]
    .filter(Boolean)
    .join('\n');

  return appendHeadTags(html, extraTags);
}

function renderFunctionalDocument(template, metadata) {
  let html = applyMetadata(template, metadata);
  html = removeCanonicalLinks(html);
  return html;
}

const vite = await createServer({
  appType: 'custom',
  mode: 'production',
  server: { middlewareMode: true }
});

try {
  const template = cleanGeneratedSeo(await readFile(templatePath, 'utf8'));
  const [{ render }, metadataModule, structuredDataModule] = await Promise.all([
    vite.ssrLoadModule('/src/entry-server.jsx'),
    vite.ssrLoadModule('/src/utils/routeMetadata.js'),
    vite.ssrLoadModule('/src/utils/structuredData.js')
  ]);
  const { getRouteMetadata, PUBLIC_ROUTES } = metadataModule;
  const { getRouteStructuredData } = structuredDataModule;

  for (const pathname of PUBLIC_ROUTES) {
    const outputFile = getRouteOutputFile(pathname);

    if (!outputFile) {
      throw new Error(`No prerender output is configured for public route: ${pathname}`);
    }

    const metadata = getRouteMetadata(pathname);
    const markup = render(pathname);
    const document = renderPublicDocument(
      template,
      markup,
      metadata,
      getRouteStructuredData(pathname, metadata)
    );
    const outputPath = resolve(outputDirectory, outputFile);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, document, 'utf8');
  }

  await writeFile(
    resolve(outputDirectory, 'sitemap.xml'),
    buildSitemap(PUBLIC_ROUTES, getRouteMetadata),
    'utf8'
  );

  const functionalMetadata = getRouteMetadata('/account');
  await writeFile(
    resolve(outputDirectory, '_seo/app.html'),
    renderFunctionalDocument(template, functionalMetadata),
    'utf8'
  );

  console.log(
    `Prerendered ${PUBLIC_ROUTES.length} public routes, generated sitemap.xml, and generated the noindex app shell.`
  );
} finally {
  await vite.close();
}
