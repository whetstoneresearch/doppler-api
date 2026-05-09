import { DopplerSDK } from '@whetstone-research/doppler-sdk/evm';

import type { ChainContext } from '../chain/registry';

export class DopplerSdkRegistry {
  private readonly sdkByChain = new Map<number, DopplerSDK>();

  constructor(contexts: ChainContext[]) {
    for (const context of contexts) {
      this.sdkByChain.set(
        context.chainId,
        new DopplerSDK({
          publicClient: context.publicClient,
          walletClient: context.walletClient,
          chainId: context.chainId,
        }),
      );
    }
  }

  get(chainId: number): DopplerSDK {
    const sdk = this.sdkByChain.get(chainId);
    if (!sdk) {
      throw new Error(`No Doppler SDK instance configured for chain ${chainId}`);
    }
    return sdk;
  }
}
