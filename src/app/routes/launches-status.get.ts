import type { FastifyInstance } from 'fastify';

import type { StatusService } from '../../modules/status/service';

export const registerLaunchStatusRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  statusService: StatusService,
) => {
  fastify.get<{ Params: { launchId: string } }>('/v1/launches/:launchId', async (request) => {
    return statusService.getLaunchStatus(request.params.launchId);
  });
};
