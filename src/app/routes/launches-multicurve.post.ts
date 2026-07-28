import type { FastifyInstance } from 'fastify';

import { AppError } from '../../core/errors';
import { createLaunchRequestSchema } from '../../modules/launches/schema';
import type { LaunchService } from '../../modules/launches/service';

const parseMulticurveLaunchRequest = (body: unknown) => {
  const payload = createLaunchRequestSchema.parse(body);
  if (payload.auction.type !== 'multicurve') {
    throw new AppError(
      422,
      'INVALID_REQUEST',
      'auction.type must be "multicurve" when using /v1/launches/multicurve',
    );
  }
  return payload;
};

export const registerCreateMulticurveAliasRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  launchService: LaunchService,
) => {
  fastify.post('/v1/launches/multicurve', async (request, reply) => {
    const rawKey = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const result = await launchService.createLaunchWithIdempotency({
      rawInput: request.body,
      parseInput: parseMulticurveLaunchRequest,
      idempotencyKey,
    });
    if (result.replayed) {
      reply.header('x-idempotency-replayed', 'true');
    }
    return result.response;
  });
};
