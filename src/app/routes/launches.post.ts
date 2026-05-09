import type { FastifyInstance } from 'fastify';

import { AppError } from '../../core/errors';
import { createLaunchRequestSchema } from '../../modules/launches/schema';
import {
  isSolanaCanonicalNetwork,
  parseGenericSolanaCreateLaunchRequest,
} from '../../modules/launches/solana';
import type { LaunchService } from '../../modules/launches/service';

const parseLaunchRequest = (body: unknown) => {
  if (typeof body === 'object' && body !== null && 'network' in body) {
    const network = (body as { network?: unknown }).network;
    if (isSolanaCanonicalNetwork(network)) {
      return parseGenericSolanaCreateLaunchRequest(body);
    }

    if (network === 'devnet' || network === 'mainnet-beta') {
      throw new AppError(
        422,
        'INVALID_REQUEST',
        'Solana requests on POST /v1/launches must use network "solanaDevnet" or "solanaMainnetBeta"',
      );
    }
  }

  return createLaunchRequestSchema.parse(body);
};

export const registerCreateLaunchRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  launchService: LaunchService,
) => {
  fastify.post('/v1/launches', async (request, reply) => {
    const payload = parseLaunchRequest(request.body);
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
