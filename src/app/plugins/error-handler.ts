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
    const isServerError = appError.statusCode >= 500;
    const message = isServerError ? 'Internal server error' : appError.message;
    const details = !isServerError && appError.details !== undefined ? appError.details : undefined;

    request.log.error(
      { err: error, code: appError.code, statusCode: appError.statusCode },
      appError.message,
    );
    reply.status(appError.statusCode).send({
      error: {
        code: appError.code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    });
  });
});
