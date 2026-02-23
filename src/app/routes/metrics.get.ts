import type { FastifyInstance } from 'fastify';

import type { MetricsRegistry } from '../../core/metrics';

export const registerMetricsRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  metrics: MetricsRegistry,
) => {
  fastify.get('/metrics', { config: { auth: false } }, async () => {
    return metrics.snapshot();
  });
};
