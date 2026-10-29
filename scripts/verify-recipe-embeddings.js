import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { embedRecipes, getEmbeddingConfig } from './embed-recipes.js';
import { runReadOnlyTransaction } from './lib/readOnlyTransaction.js';

const EXPECTED_FIELDS = {
  '--expect-recipes=': 'recipes',
  '--expect-embeddings=': 'embeddings',
  '--expect-current=': 'current',
  '--expect-missing=': 'missing',
  '--expect-stale=': 'stale'
};

function parseNonNegativeInteger(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseVerificationArgs(argv = process.argv.slice(2)) {
  const options = {
    limit: null,
    batchSize: 100,
    expected: {}
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--limit=')) {
      options.limit = Math.max(1, parseNonNegativeInteger(arg.slice('--limit='.length), options.limit));
    }
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = Math.max(
        1,
        parseNonNegativeInteger(arg.slice('--batch-size='.length), options.batchSize)
      );
    }
    Object.entries(EXPECTED_FIELDS).forEach(([prefix, field]) => {
      if (arg.startsWith(prefix)) {
        options.expected[field] = parseNonNegativeInteger(arg.slice(prefix.length));
      }
    });
  });

  return options;
}

function numberValue(value) {
  return Number(value || 0);
}

async function loadIntegritySnapshot(prisma) {
  const [snapshot] = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM recipes) AS recipe_count,
      (SELECT count(*)::int FROM recipe_embeddings) AS embedding_count,
      (
        SELECT count(*)::int
        FROM (
          SELECT recipe_id, embedding_model, embedding_dimensions
          FROM recipe_embeddings
          GROUP BY recipe_id, embedding_model, embedding_dimensions
          HAVING count(*) > 1
        ) duplicates
      ) AS duplicate_count,
      (
        SELECT count(*)::int
        FROM recipe_embeddings re
        LEFT JOIN recipes r ON r.id = re.recipe_id
        WHERE r.id IS NULL
      ) AS orphan_count,
      (
        SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND c.relname = 'recipe_embeddings'
          AND a.attname = 'embedding'
          AND a.attnum > 0
          AND NOT a.attisdropped
        LIMIT 1
      ) AS embedding_type
  `);
  const groups = await prisma.$queryRawUnsafe(`
    SELECT embedding_model, embedding_dimensions, count(*)::int AS count
    FROM recipe_embeddings
    GROUP BY embedding_model, embedding_dimensions
    ORDER BY embedding_model, embedding_dimensions
  `);

  return {
    recipes: numberValue(snapshot?.recipe_count),
    embeddings: numberValue(snapshot?.embedding_count),
    duplicateKeys: numberValue(snapshot?.duplicate_count),
    orphanEmbeddings: numberValue(snapshot?.orphan_count),
    embeddingType: String(snapshot?.embedding_type || ''),
    groups: groups.map((group) => ({
      model: String(group.embedding_model || ''),
      dimensions: numberValue(group.embedding_dimensions),
      count: numberValue(group.count)
    }))
  };
}

function addExpectationFailure(failures, label, actual, expected) {
  if (expected !== null && expected !== undefined && actual !== expected) {
    failures.push(`${label}: expected ${expected}, received ${actual}`);
  }
}

export async function verifyRecipeEmbeddings(options = parseVerificationArgs()) {
  const prisma = options.prismaClient || new PrismaClient();
  const scan = options.scanEmbeddings || embedRecipes;
  const config = { ...getEmbeddingConfig(), ...options.embeddingConfig };

  try {
    return await runReadOnlyTransaction(prisma, async (transaction) => {
      const integrity = await loadIntegritySnapshot(transaction);
      const scanSummary = await scan({
        dryRun: true,
        limit: options.limit ?? integrity.recipes,
        batchSize: options.batchSize || 100,
        quiet: true,
        prismaClient: transaction,
        embeddingConfig: config
      });
      const failures = [];
      const expectedType = `vector(${config.dimensions})`;
      const expected = options.expected || {};

      if (integrity.duplicateKeys !== 0) failures.push(`duplicate keys: ${integrity.duplicateKeys}`);
      if (integrity.orphanEmbeddings !== 0) {
        failures.push(`orphan embeddings: ${integrity.orphanEmbeddings}`);
      }
      if (integrity.embeddingType !== expectedType) {
        failures.push(`embedding type: expected ${expectedType}, received ${integrity.embeddingType || 'missing'}`);
      }
      if (
        integrity.groups.length !== 1 ||
        integrity.groups[0]?.model !== config.model ||
        integrity.groups[0]?.dimensions !== config.dimensions ||
        integrity.groups[0]?.count !== integrity.embeddings
      ) {
        failures.push('model/dimension groups do not match the configured embedding source of truth');
      }
      if (scanSummary.processed !== integrity.recipes) {
        failures.push(`catalog scan: expected ${integrity.recipes}, processed ${scanSummary.processed}`);
      }
      if (scanSummary.current + scanSummary.missing + scanSummary.stale !== integrity.recipes) {
        failures.push('current/missing/stale counts do not cover the full recipe catalog');
      }

      addExpectationFailure(failures, 'recipes', integrity.recipes, expected.recipes);
      addExpectationFailure(failures, 'embeddings', integrity.embeddings, expected.embeddings);
      addExpectationFailure(failures, 'current', scanSummary.current, expected.current);
      addExpectationFailure(failures, 'missing', scanSummary.missing, expected.missing);
      addExpectationFailure(failures, 'stale', scanSummary.stale, expected.stale);

      return {
        passed: failures.length === 0,
        ...integrity,
        current: scanSummary.current,
        missing: scanSummary.missing,
        stale: scanSummary.stale,
        apiRequestCount: scanSummary.apiRequestCount,
        productionWrites: 0,
        failures
      };
    });
  } finally {
    if (!options.prismaClient) await prisma.$disconnect();
  }
}

function formatGroups(groups = []) {
  return groups.map((group) => `${group.model}/${group.dimensions}:${group.count}`).join(',') || 'none';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRecipeEmbeddings(parseVerificationArgs())
    .then((result) => {
      console.log(
        `Verification: passed=${result.passed} recipes=${result.recipes} embeddings=${result.embeddings} current=${result.current} missing=${result.missing} stale=${result.stale} duplicateKeys=${result.duplicateKeys} orphanEmbeddings=${result.orphanEmbeddings} embeddingType=${result.embeddingType || 'missing'} groups=${formatGroups(result.groups)} apiRequestCount=${result.apiRequestCount} productionWrites=0`
      );
      if (!result.passed) {
        result.failures.forEach((failure) => console.error(`Verification failure: ${failure}`));
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
