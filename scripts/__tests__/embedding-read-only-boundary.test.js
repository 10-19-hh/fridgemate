import { describe, expect, it, vi } from 'vitest';
import { createRecipeEmbeddingCheckpoint } from '../checkpoint-recipe-embeddings.js';
import { verifyRecipeEmbeddings } from '../verify-recipe-embeddings.js';

const entryPoints = [
  ['checkpoint dry-run', (prismaClient) => createRecipeEmbeddingCheckpoint({ dryRun: true, prismaClient })],
  ['embedding verification', (prismaClient) => verifyRecipeEmbeddings({
    prismaClient,
    embeddingConfig: { model: 'fixture-model', dimensions: 3 },
    scanEmbeddings: async () => ({ processed: 1, current: 1, missing: 0, stale: 0, apiRequestCount: 0 })
  })]
];

function createQueryClient(events = []) {
  return {
    $disconnect: vi.fn(),
    $executeRawUnsafe: vi.fn(async () => {
      await Promise.resolve();
      events.push('read-only');
    }),
    $queryRawUnsafe: vi.fn(async (sql) => {
      events.push('query');
      return sql.includes('GROUP BY embedding_model')
        ? [{ embedding_model: 'fixture-model', embedding_dimensions: 3, count: 1 }]
        : [{ recipe_count: 1, embedding_count: 1, duplicate_count: 0, orphan_count: 0, embedding_type: 'vector(3)' }];
    })
  };
}

describe.each(entryPoints)('%s read-only boundary', (_label, run) => {
  it('awaits read-only setup before queries and preserves transaction limits and client ownership', async () => {
    const events = [];
    const transaction = createQueryClient(events);
    const prisma = {
      $disconnect: vi.fn(),
      $queryRawUnsafe: vi.fn(),
      $transaction: vi.fn(async (operation) => operation(transaction))
    };

    const result = await run(prisma);

    expect(events[0]).toBe('read-only');
    expect(events.slice(1).length).toBeGreaterThan(0);
    expect(events.slice(1).every((event) => event === 'query')).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function), { maxWait: 10000, timeout: 600000 }
    );
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledExactlyOnceWith('SET TRANSACTION READ ONLY');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$disconnect).not.toHaveBeenCalled();
    expect(transaction.$disconnect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ productionWrites: 0 });
  });

  it('does not query when read-only setup fails', async () => {
    const error = new Error('fixture read-only setup failure');
    const transaction = createQueryClient();
    transaction.$executeRawUnsafe.mockRejectedValueOnce(error);
    const prisma = { $transaction: (operation) => operation(transaction) };

    await expect(run(prisma)).rejects.toBe(error);

    expect(transaction.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(transaction.$disconnect).not.toHaveBeenCalled();
  });

  it('propagates query errors without disconnecting an injected client', async () => {
    const error = new Error('fixture query failure');
    const transaction = createQueryClient();
    transaction.$queryRawUnsafe.mockRejectedValueOnce(error);
    const prisma = { $transaction: (operation) => operation(transaction), $disconnect: vi.fn() };

    await expect(run(prisma)).rejects.toBe(error);

    expect(transaction.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });

  it('propagates transaction startup errors', async () => {
    const error = new Error('fixture transaction startup failure');
    const prisma = { $transaction: vi.fn().mockRejectedValueOnce(error), $disconnect: vi.fn() };

    await expect(run(prisma)).rejects.toBe(error);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });

  it('preserves support for injected clients without a transaction method', async () => {
    const prisma = createQueryClient();

    const result = await run(prisma);

    expect(result).toMatchObject({ productionWrites: 0 });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });
});
