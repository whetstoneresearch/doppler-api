import { describe, expect, it, vi } from 'vitest';

import { TxSubmitter } from '../../src/infra/tx/submitter';

describe('tx submitter', () => {
  it('retries once on nonce errors with refreshed pending nonce', async () => {
    const getTransactionCount = vi.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(8);
    const writeContract = vi
      .fn()
      .mockRejectedValueOnce(new Error('nonce too low'))
      .mockResolvedValueOnce('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount,
      },
      walletClient: {
        account: { address: '0x1111111111111111111111111111111111111111' },
        writeContract,
      },
    } as any;

    const submitter = new TxSubmitter();
    const txHash = await submitter.submitCreateTx({
      chain,
      request: { to: '0x2222222222222222222222222222222222222222' },
    });

    expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(getTransactionCount).toHaveBeenCalledTimes(2);
    expect(writeContract).toHaveBeenCalledTimes(2);
    expect(writeContract.mock.calls[0][0].nonce).toBe(7);
    expect(writeContract.mock.calls[1][0].nonce).toBe(8);
  });
});
