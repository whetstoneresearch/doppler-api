import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { asAppError } from '../../core/errors';

export default fp(async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(422).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Request failed validation',
          details: error.flatten(),
        },
      });
      return;
    }

    const appError = asAppError(error);

    request.log.error({ err: error, code: appError.code }, appError.message);
    reply.status(appError.statusCode).send({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
      },
    });
  });
});
