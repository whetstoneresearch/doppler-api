import type { FastifyInstance } from 'fastify';

import type { ChainRegistry } from '../../infra/chain/registry';
import type { PricingService } from '../../modules/pricing/service';

export const registerCapabilitiesRoute = async (
  fastify: FastifyInstance<any, any, any, any>,
  chainRegistry: ChainRegistry,
  pricingService: PricingService,
) => {
  fastify.get('/v1/capabilities', { config: { auth: false } }, async () => {
    return {
      defaultChainId: chainRegistry.defaultChainId,
      pricing: {
        enabled: pricingService.isEnabled(),
        provider: pricingService.getProviderName(),
      },
      chains: chainRegistry.list().map((chain) => ({
        chainId: chain.chainId,
        auctionTypes: chain.config.auctionTypes,
        migrationModes: chain.config.migrationModes,
        governanceModes: ['noOp'],
        governanceEnabled: false,
      })),
    };
  });
};
