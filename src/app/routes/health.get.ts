import type { FastifyInstance } from 'fastify';

export const registerHealthRoute = async (fastify: FastifyInstance<any, any, any, any>) => {
  fastify.get('/health', { config: { auth: false } }, async () => ({ status: 'ok' }));
};
