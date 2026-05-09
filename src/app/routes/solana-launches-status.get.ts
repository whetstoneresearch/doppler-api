import type { FastifyInstance } from 'fastify';

import type { SolanaLaunchService } from '../../modules/launches/solana';

export const registerSolanaLaunchStatusRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  solanaLaunchService: SolanaLaunchService,
) => {
  fastify.get<{ Params: { launchAddress: string } }>(
    '/v1/solana/launches/:launchAddress',
    async (request) => {
      return solanaLaunchService.getLaunch(request.params.launchAddress);
    },
  );
};
