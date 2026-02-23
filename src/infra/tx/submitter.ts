import { AppError } from '../../core/errors';
import type { HexHash } from '../../core/types';
import type { ChainContext } from '../chain/registry';

const isNonceError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('nonce too low') ||
    msg.includes('already known') ||
    msg.includes('replacement transaction underpriced')
  );
};

export class TxSubmitter {
  private readonly queueByChain = new Map<number, Promise<unknown>>();

  private async withChainLock<T>(chainId: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.queueByChain.get(chainId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queueByChain.set(
      chainId,
      previous.then(() => current),
    );

    await previous;
    try {
      return await fn();
    } finally {
      release?.();
    }
  }

  async submitCreateTx(args: {
    chain: ChainContext;
    request: Record<string, unknown>;
    gasEstimate?: bigint;
  }): Promise<HexHash> {
    const { chain, request, gasEstimate } = args;
    const account = chain.walletClient.account;
    if (!account) {
      throw new AppError(
        500,
        'INTERNAL_ERROR',
        `Wallet account not configured for chain ${chain.chainId}`,
      );
    }

    return this.withChainLock(chain.chainId, async () => {
      const pendingNonce = await chain.publicClient.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      });

      const txArgs = {
        ...request,
        nonce: pendingNonce,
        ...(gasEstimate ? { gas: gasEstimate } : {}),
      } as Record<string, unknown>;

      try {
        return (await chain.walletClient.writeContract(txArgs as any)) as HexHash;
      } catch (error) {
        if (!isNonceError(error)) throw error;

        const retryNonce = await chain.publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        });
        const retryArgs = { ...txArgs, nonce: retryNonce };
        return (await chain.walletClient.writeContract(retryArgs as any)) as HexHash;
      }
    });
  }
}
