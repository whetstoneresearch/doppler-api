import type { FastifyInstance } from 'fastify';

import { AppError } from '../../core/errors';
import { createLaunchRequestSchema } from '../../modules/launches/schema';
import type { LaunchService } from '../../modules/launches/service';

const parseStaticLaunchRequest = (body: unknown) => {
  const payload = createLaunchRequestSchema.parse(body);
  if (payload.auction.type !== 'static') {
    throw new AppError(
      422,
      'INVALID_REQUEST',
      'auction.type must be "static" when using /v1/launches/static',
    );
  }
  return payload;
};

export const registerCreateStaticAliasRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  launchService: LaunchService,
) => {
  fastify.post('/v1/launches/static', async (request, reply) => {
    const rawKey = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const result = await launchService.createLaunchWithIdempotency({
      rawInput: request.body,
      parseInput: parseStaticLaunchRequest,
      idempotencyKey,
    });
    if (result.replayed) {
      reply.header('x-idempotency-replayed', 'true');
    }
    return result.response;
  });
};
