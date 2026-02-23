import fp from 'fastify-plugin';

import { AppError } from '../../core/errors';

export interface AuthPluginOptions {
  apiKeys: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    requireApiKey?: boolean;
  }
}

export default fp<AuthPluginOptions>(async (fastify, options) => {
  const allowed = new Set(options.apiKeys);

  fastify.addHook('onRequest', async (request, reply) => {
    const routeConfig = ((request as any).routeOptions?.config ?? (request as any).routeConfig) as
      | { auth?: boolean }
      | undefined;
    const authDisabled = routeConfig?.auth === false;
    if (authDisabled) return;

    const key = request.headers['x-api-key'];
    const normalized = Array.isArray(key) ? key[0] : key;
    if (!normalized || !allowed.has(normalized)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid x-api-key');
    }

    reply.header('cache-control', 'no-store');
  });
});
