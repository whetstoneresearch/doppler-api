import fp from 'fastify-plugin';

import type { MetricsRegistry } from '../../core/metrics';

export interface RequestLoggerPluginOptions {
  metrics: MetricsRegistry;
}

export default fp<RequestLoggerPluginOptions>(async (fastify, options) => {
  fastify.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const duration = Number(reply.elapsedTime ?? 0);
    options.metrics.recordHttp(reply.statusCode, duration);

    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: duration,
      },
      'request_complete',
    );
  });
});
