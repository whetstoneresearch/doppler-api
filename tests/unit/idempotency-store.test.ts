import { describe, expect, it } from 'vitest';

import { IdempotencyStore } from '../../src/infra/idempotency/store';

const samplePayload = {
  userAddress: '0x1111111111111111111111111111111111111111',
  tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
  tokenomics: { totalSupply: '1000' },
  governance: { enabled: false, mode: 'noOp' as const },
  migration: { type: 'noOp' as const },
  auction: { type: 'multicurve' as const, curveConfig: { type: 'preset' as const } },
};

describe('idempotency store', () => {
  it('replays same key and payload', async () => {
    const runId = Date.now().toString();
    const store = new IdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      path: `.test-results/idempotency-unit-test-${runId}.json`,
    });

    const first = await store.execute('abc', samplePayload as any, async () => ({
      launchId: '84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 84532,
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      statusUrl:
        '/v1/launches/84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      predicted: {
        tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        poolId: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      effectiveConfig: {
        tokensForSale: '1000',
        allocationAmount: '0',
        allocationRecipient: '0x1111111111111111111111111111111111111111',
        allocationLockMode: 'none' as const,
        allocationLockDurationSeconds: 0,
        numeraireAddress: '0x4200000000000000000000000000000000000006',
        numerairePriceUsd: 1000,
        feeBeneficiariesSource: 'default' as const,
      },
    }));

    const second = await store.execute('abc', samplePayload as any, async () => {
      throw new Error('should not be called');
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.response.txHash).toBe(first.response.txHash);
  });

  it('rejects same key with different payload', async () => {
    const runId = (Date.now() + 1).toString();
    const store = new IdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      path: `.test-results/idempotency-unit-test-2-${runId}.json`,
    });

    await store.execute('abc', samplePayload as any, async () => ({
      launchId: '84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 84532,
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      statusUrl:
        '/v1/launches/84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      predicted: {
        tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        poolId: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      effectiveConfig: {
        tokensForSale: '1000',
        allocationAmount: '0',
        allocationRecipient: '0x1111111111111111111111111111111111111111',
        allocationLockMode: 'none' as const,
        allocationLockDurationSeconds: 0,
        numeraireAddress: '0x4200000000000000000000000000000000000006',
        numerairePriceUsd: 1000,
        feeBeneficiariesSource: 'default' as const,
      },
    }));

    await expect(
      store.execute(
        'abc',
        {
          ...samplePayload,
          tokenMetadata: { ...samplePayload.tokenMetadata, symbol: 'DIFF' },
        } as any,
        async () => {
          throw new Error('should not be called');
        },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE_MISMATCH', statusCode: 409 });
  });
});
