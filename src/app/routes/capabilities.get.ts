import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../../core/config';
import type { ChainRegistry } from '../../infra/chain/registry';
import { SOLANA_CONSTANTS } from '../../modules/launches/solana';
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
  config: AppConfig,
  chainRegistry: ChainRegistry,
  pricingService: PricingService,
) => {
  fastify.get('/v1/capabilities', async () => {
    const solanaPriceResolutionModes: Array<'request' | 'fixed' | 'coingecko'> = ['request'];
    if (config.solana.fixedNumerairePriceUsd !== undefined) {
      solanaPriceResolutionModes.push('fixed');
    }
    if (config.solana.priceMode === 'coingecko') {
      solanaPriceResolutionModes.push('coingecko');
    }

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
        governanceModes: chain.config.governanceModes,
        governanceEnabled: chain.config.governanceEnabled,
      })),
      solana: {
        enabled: config.solana.enabled,
        supportedNetworks: config.solana.enabled ? ['solanaDevnet'] : [],
        unsupportedNetworks: config.solana.enabled
          ? ['solanaMainnetBeta']
          : ['solanaDevnet', 'solanaMainnetBeta'],
        dedicatedRouteInputAliases: ['devnet', 'mainnet-beta'],
        creationOnly: true,
        numeraireAddress: SOLANA_CONSTANTS.wsolMintAddress,
        priceResolutionModes: solanaPriceResolutionModes,
      },
    };
  });
};
