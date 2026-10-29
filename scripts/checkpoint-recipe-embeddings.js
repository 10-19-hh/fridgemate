import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import { runReadOnlyTransaction } from './lib/readOnlyTransaction.js';

const DEFAULT_OUTPUT_DIR = '.local/recipe-embedding-checkpoints';

export function parseCheckpointArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: argv.includes('--dry-run'),
    outputDir: DEFAULT_OUTPUT_DIR,
    label: ''
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length).trim() || DEFAULT_OUTPUT_DIR;
    }
    if (arg.startsWith('--label=')) options.label = arg.slice('--label='.length).trim();
  });

  return options;
}

function safeLabel(value = '') {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function serializeRow(row) {
  return {
    id: String(row.id),
    recipeId: String(row.recipe_id),
    embeddingText: String(row.embedding_text || ''),
    embedding: String(row.embedding || ''),
    embeddingModel: String(row.embedding_model || ''),
    embeddingDimensions: Number(row.embedding_dimensions),
    contentHash: String(row.content_hash || ''),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || '')
  };
}

function summarizeGroups(rows = []) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = `${row.embeddingModel}\u0000${row.embeddingDimensions}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([key, count]) => {
      const [embeddingModel, dimensions] = key.split('\u0000');
      return { embeddingModel, embeddingDimensions: Number(dimensions), count };
    })
    .sort((left, right) =>
      left.embeddingModel.localeCompare(right.embeddingModel) ||
      left.embeddingDimensions - right.embeddingDimensions
    );
}

async function loadRows(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      id,
      recipe_id,
      embedding_text,
      embedding::text AS embedding,
      embedding_model,
      embedding_dimensions,
      content_hash,
      created_at,
      updated_at
    FROM recipe_embeddings
    ORDER BY recipe_id, embedding_model, embedding_dimensions
  `);
  return rows.map(serializeRow);
}

async function loadGroupSummary(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT embedding_model, embedding_dimensions, count(*)::int AS count
    FROM recipe_embeddings
    GROUP BY embedding_model, embedding_dimensions
    ORDER BY embedding_model, embedding_dimensions
  `);
  const groups = rows.map((row) => ({
    embeddingModel: String(row.embedding_model || ''),
    embeddingDimensions: Number(row.embedding_dimensions),
    count: Number(row.count || 0)
  }));
  return {
    rowCount: groups.reduce((sum, group) => sum + group.count, 0),
    groups,
    productionWrites: 0
  };
}

export async function createRecipeEmbeddingCheckpoint(options = parseCheckpointArgs()) {
  const prisma = options.prismaClient || new PrismaClient();
  try {
    if (options.dryRun) {
      return { ...(await runReadOnlyTransaction(prisma, loadGroupSummary)), dryRun: true };
    }

    const rows = await runReadOnlyTransaction(prisma, loadRows);
    const groups = summarizeGroups(rows);

    const createdAt = options.now || new Date();
    const label = safeLabel(options.label);
    const stem = `recipe-embeddings-${timestampForFile(createdAt)}${label ? `-${label}` : ''}`;
    const outputDir = path.resolve(process.cwd(), options.outputDir || DEFAULT_OUTPUT_DIR);
    const checkpointPath = path.join(outputDir, `${stem}.jsonl.gz`);
    const manifestPath = path.join(outputDir, `${stem}.manifest.json`);
    const jsonl = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
    const compressed = gzipSync(Buffer.from(jsonl, 'utf8'), { level: 9 });
    const sha256 = createHash('sha256').update(compressed).digest('hex');

    await mkdir(outputDir, { recursive: true });
    await writeFile(checkpointPath, compressed);

    const verifiedBytes = await readFile(checkpointPath);
    const verifiedSha256 = createHash('sha256').update(verifiedBytes).digest('hex');
    const restoredLines = gunzipSync(verifiedBytes)
      .toString('utf8')
      .split('\n')
      .filter(Boolean);
    if (verifiedSha256 !== sha256 || restoredLines.length !== rows.length) {
      throw new Error('Recipe embedding checkpoint verification failed.');
    }

    const manifest = {
      version: 1,
      createdAt: createdAt.toISOString(),
      checkpointFile: path.basename(checkpointPath),
      manifestFile: path.basename(manifestPath),
      rowCount: rows.length,
      compressedBytes: verifiedBytes.length,
      sha256,
      groups,
      containsRawVectors: true,
      productionWrites: 0,
      verified: true
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    return { ...manifest, checkpointPath, manifestPath };
  } finally {
    if (!options.prismaClient) await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createRecipeEmbeddingCheckpoint(parseCheckpointArgs())
    .then((result) => {
      console.log(
        `Checkpoint: dryRun=${Boolean(result.dryRun)} rows=${result.rowCount} bytes=${result.compressedBytes || 0} sha256=${result.sha256 || 'not-generated'} verified=${Boolean(result.verified)} productionWrites=0`
      );
      if (!result.dryRun) {
        console.log(`Checkpoint file: ${result.checkpointPath}`);
        console.log(`Manifest file: ${result.manifestPath}`);
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
