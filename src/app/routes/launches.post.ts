import type { FastifyInstance } from 'fastify';

import { createLaunchRequestSchema } from '../../modules/launches/schema';
import type { LaunchService } from '../../modules/launches/service';

export const registerCreateLaunchRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  launchService: LaunchService,
) => {
  fastify.post('/v1/launches', async (request, reply) => {
    const payload = createLaunchRequestSchema.parse(request.body);
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
