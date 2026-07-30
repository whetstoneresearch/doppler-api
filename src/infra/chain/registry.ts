import { getAddresses } from '@whetstone-research/doppler-sdk/evm';
import { defineChain, http, createPublicClient, createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { AppConfig, ChainRuntimeConfig } from '../../core/config';
import { AppError } from '../../core/errors';

const RPC_REQUEST_TIMEOUT_MS = 30_000;

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

const REQUIRED_ADDRESS_KEYS = [
  'lockableV3Initializer',
  'dopplerHookInitializer',
  'rehypeDopplerHookInitializer',
  'v4Initializer',
  'v2MigratorSplit',
  'dopplerHookMigrator',
  'rehypeDopplerHookMigrator',
  'dopplerERC20V1Factory',
  'dopplerERC20V1Implementation',
  'noOpGovernanceFactory',
  'governanceFactory',
  'launchpadGovernanceFactory',
] as const;

const assertCanonicalAddresses = (
  chainId: number,
  addresses: ReturnType<typeof getAddresses>,
): void => {
  for (const key of REQUIRED_ADDRESS_KEYS) {
    if (!addresses[key]) {
      throw new AppError(
        500,
        'UNSUPPORTED_CHAIN',
        `Doppler SDK is missing ${key} for chain ${chainId}`,
      );
    }
  }
};

export class ChainRegistry {
  private readonly contexts: Map<number, ChainContext>;
  readonly defaultChainId: number | null;

  constructor(config: AppConfig) {
    this.defaultChainId = config.defaultChainId;
    this.contexts = new Map<number, ChainContext>();

    const account = privateKeyToAccount(config.privateKey);

    for (const chainConfig of Object.values(config.chains)) {
      const chainDef = getChainDefinition(chainConfig.chainId, chainConfig.rpcUrl);
      const publicClient = createPublicClient({
        chain: chainDef,
        transport: http(chainConfig.rpcUrl, { timeout: RPC_REQUEST_TIMEOUT_MS }),
      });
      const walletClient = createWalletClient({
        chain: chainDef,
        transport: http(chainConfig.rpcUrl, { timeout: RPC_REQUEST_TIMEOUT_MS }),
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

      assertCanonicalAddresses(chainConfig.chainId, addresses);

      this.contexts.set(chainConfig.chainId, {
        chainId: chainConfig.chainId,
        config: chainConfig,
        publicClient,
        walletClient,
        addresses,
      });
    }
  }

  get(chainId?: number | null): ChainContext {
    const target = chainId ?? this.defaultChainId;
    if (target === null) {
      throw new AppError(
        422,
        'CHAIN_ID_REQUIRED',
        'chainId is required because DEFAULT_CHAIN_ID is not configured',
      );
    }

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
