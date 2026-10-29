export async function runReadOnlyTransaction(prisma, operation) {
  if (typeof prisma.$transaction !== 'function') return operation(prisma);
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return operation(transaction);
    },
    { maxWait: 10000, timeout: 600000 }
  );
}
