import type { FastifyInstance } from 'fastify';

import type { ChainRegistry } from '../../infra/chain/registry';
import type { PricingService } from '../../modules/pricing/service';

const resolveMulticurveInitializers = (chain: ReturnType<ChainRegistry['list']>[number]) => {
  const modes: Array<'standard' | 'scheduled' | 'decay' | 'rehype'> = ['standard'];
  const addresses = chain.addresses as Partial<{
    v4ScheduledMulticurveInitializer: string;
    v4DecayMulticurveInitializer: string;
    dopplerHookInitializer: string;
    rehypeDopplerHook: string;
  }>;

  if (addresses.v4ScheduledMulticurveInitializer) modes.push('scheduled');
  if (addresses.v4DecayMulticurveInitializer) modes.push('decay');
  if (addresses.dopplerHookInitializer && addresses.rehypeDopplerHook) modes.push('rehype');

  return modes;
};

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
        multicurveInitializers: chain.config.auctionTypes.includes('multicurve')
          ? resolveMulticurveInitializers(chain)
          : [],
        migrationModes: chain.config.migrationModes,
        governanceModes: ['noOp'],
        governanceEnabled: false,
      })),
    };
  });
};
