import type { FastifyInstance } from 'fastify';

import { AppError } from '../../core/errors';
import { createLaunchRequestSchema } from '../../modules/launches/schema';
import type { LaunchService } from '../../modules/launches/service';

export const registerCreateStaticAliasRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  launchService: LaunchService,
) => {
  fastify.post('/v1/launches/static', async (request, reply) => {
    const payload = createLaunchRequestSchema.parse(request.body);
    if (payload.auction.type !== 'static') {
      throw new AppError(
        422,
        'INVALID_REQUEST',
        'auction.type must be "static" when using /v1/launches/static',
      );
    }

    const rawKey = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const result = await launchService.createLaunchWithIdempotency({
      idempotencyKey,
      input: {
        ...payload,
        auction: {
          type: 'static',
          curveConfig: payload.auction.curveConfig,
        },
      },
    });
    if (result.replayed) {
      reply.header('x-idempotency-replayed', 'true');
    }
    return result.response;
  });
};
