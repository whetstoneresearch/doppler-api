import type { FastifyInstance } from 'fastify';

import type { ChainRegistry } from '../../infra/chain/registry';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const registerReadyRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  chainRegistry: ChainRegistry,
  timeoutMs: number,
) => {
  fastify.get('/ready', { config: { auth: false } }, async (request, reply) => {
    const checks = await Promise.all(
      chainRegistry.list().map(async (chain) => {
        try {
          const block = await withTimeout(chain.publicClient.getBlockNumber(), timeoutMs);
          return {
            chainId: chain.chainId,
            ok: true,
            latestBlock: block.toString(),
          };
        } catch (error) {
          return {
            chainId: chain.chainId,
            ok: false,
            error: error instanceof Error ? error.message : 'unknown',
          };
        }
      }),
    );

    const ok = checks.every((check) => check.ok);
    if (!ok) {
      reply.status(503);
    }

    return {
      status: ok ? 'ready' : 'degraded',
      checks,
    };
  });
};
