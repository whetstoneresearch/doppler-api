import type { FastifyInstance } from 'fastify';

import type { SolanaNetwork } from '../../core/types';
import { parseDedicatedSolanaCreateLaunchRequest } from '../../modules/launches/solana';
import type { LaunchService } from '../../modules/launches/service';

export const registerCreateSolanaLaunchRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  launchService: LaunchService,
  defaultNetwork: SolanaNetwork,
) => {
  fastify.post('/v1/solana/launches', async (request, reply) => {
    const payload = parseDedicatedSolanaCreateLaunchRequest(request.body, defaultNetwork);
    const rawKey = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const result = await launchService.createLaunchWithIdempotency({
      input: payload,
      idempotencyKey,
    });
    if (result.replayed) {
      reply.header('x-idempotency-replayed', 'true');
    }
    return result.response;
  });
};
