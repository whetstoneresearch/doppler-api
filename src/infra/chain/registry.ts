import { getAddresses } from '@whetstone-research/doppler-sdk/evm';
import { defineChain, http, createPublicClient, createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { AppConfig, ChainRuntimeConfig } from '../../core/config';
import { AppError } from '../../core/errors';

export interface ChainContext {
  chainId: number;
  config: ChainRuntimeConfig;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  addresses: ReturnType<typeof getAddresses>;
}

const getChainDefinition = (chainId: number, rpcUrl: string) =>
  defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'Native', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    },
  });

export class ChainRegistry {
  private readonly contexts: Map<number, ChainContext>;
  readonly defaultChainId: number;

  constructor(config: AppConfig) {
    this.defaultChainId = config.defaultChainId;
    this.contexts = new Map<number, ChainContext>();

    const account = privateKeyToAccount(config.privateKey);

    for (const chainConfig of Object.values(config.chains)) {
      const chainDef = getChainDefinition(chainConfig.chainId, chainConfig.rpcUrl);
      const publicClient = createPublicClient({
        chain: chainDef,
        transport: http(chainConfig.rpcUrl),
      });
      const walletClient = createWalletClient({
        chain: chainDef,
        transport: http(chainConfig.rpcUrl),
        account,
      });

      let addresses: ReturnType<typeof getAddresses>;
      try {
        addresses = getAddresses(chainConfig.chainId);
      } catch (error) {
        throw new AppError(
          500,
          'UNSUPPORTED_CHAIN',
          `Doppler SDK does not support chain ${chainConfig.chainId}`,
          error,
        );
      }

      this.contexts.set(chainConfig.chainId, {
        chainId: chainConfig.chainId,
        config: chainConfig,
        publicClient,
        walletClient,
        addresses,
      });
    }
  }

  get(chainId?: number): ChainContext {
    const target = chainId ?? this.defaultChainId;
    const context = this.contexts.get(target);
    if (!context) {
      throw new AppError(
        422,
        'CHAIN_NOT_CONFIGURED',
        `Chain ${target} is not configured for this deployment`,
      );
    }
    return context;
  }

  list(): ChainContext[] {
    return [...this.contexts.values()];
  }
}
