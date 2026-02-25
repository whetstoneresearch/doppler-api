import { describe, expect, it, vi } from 'vitest';

import { createDynamicLaunch } from '../../src/modules/auctions/dynamic/service';
import type { CreateDynamicLaunchRequestInput } from '../../src/modules/launches/schema';

describe('dynamic launch service', () => {
  it('maps dynamic market-cap/proceeds config into SDK builder with uniswapV2 migration', async () => {
    const builder = {
      tokenConfig: vi.fn().mockReturnThis(),
      saleConfig: vi.fn().mockReturnThis(),
      withMarketCapRange: vi.fn().mockReturnThis(),
      withIntegrator: vi.fn().mockReturnThis(),
      withVesting: vi.fn().mockReturnThis(),
      withGovernance: vi.fn().mockReturnThis(),
      withMigration: vi.fn().mockReturnThis(),
      withUserAddress: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ any: 'params' }),
    };

    const simulation = {
      createParams: { salt: '0x03' },
      tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      hookAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
      poolId: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      gasEstimate: 789n,
    };

    const sdk = {
      buildDynamicAuction: vi.fn(() => builder),
      getAirlockOwner: vi.fn().mockResolvedValue('0x9999999999999999999999999999999999999999'),
      factory: {
        simulateCreateDynamicAuction: vi.fn().mockResolvedValue(simulation),
      },
    };

    const chain = {
      chainId: 84532,
      config: {
        chainId: 84532,
        rpcUrl: 'http://localhost:8545',
        defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
        auctionTypes: ['multicurve', 'dynamic'],
        migrationModes: ['noOp', 'uniswapV2'],
        governanceModes: ['noOp', 'default'],
        governanceEnabled: true,
      },
      addresses: {
        airlock: '0x0000000000000000000000000000000000000001',
        weth: '0x4200000000000000000000000000000000000006',
      },
      publicClient: {
        simulateContract: vi.fn().mockResolvedValue({ request: { to: '0xairlock' } }),
      },
      walletClient: {
        account: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      },
    };

    const pricingService = {
      resolveNumerairePriceUsd: vi.fn().mockResolvedValue(3000),
    };

    const txSubmitter = {
      submitCreateTx: vi
        .fn()
        .mockResolvedValue('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    };

    const input: CreateDynamicLaunchRequestInput = {
      chainId: 84532,
      userAddress: '0x1111111111111111111111111111111111111111',
      integrationAddress: '0x2222222222222222222222222222222222222222',
      tokenMetadata: { name: 'Dynamic', symbol: 'DYN', tokenURI: 'ipfs://token' },
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '800',
      },
      migration: { type: 'uniswapV2' },
      governance: true,
      auction: {
        type: 'dynamic',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapMinUsd: 50,
          minProceeds: '0.01',
          maxProceeds: '0.1',
          durationSeconds: 86_400,
        },
      },
    };

    const response = await createDynamicLaunch({
      input,
      chain: chain as any,
      sdkRegistry: {
        get: vi.fn().mockReturnValue(sdk),
      } as any,
      pricingService: pricingService as any,
      txSubmitter: txSubmitter as any,
    });

    expect(sdk.buildDynamicAuction).toHaveBeenCalled();
    expect(builder.withMarketCapRange).toHaveBeenCalledWith(
      expect.objectContaining({
        marketCap: { start: 100, min: 50 },
        minProceeds: 10_000_000_000_000_000n,
        maxProceeds: 100_000_000_000_000_000n,
        duration: 86_400,
      }),
    );
    expect(builder.withIntegrator).toHaveBeenCalledWith(
      '0x2222222222222222222222222222222222222222',
    );
    expect(builder.withMigration).toHaveBeenCalledWith({ type: 'uniswapV2' });
    expect(builder.withGovernance).toHaveBeenCalledWith({ type: 'default' });
    expect(builder.withVesting).toHaveBeenCalledTimes(1);

    expect(txSubmitter.submitCreateTx).toHaveBeenCalledWith(
      expect.objectContaining({
        gasEstimate: 789n,
      }),
    );
    expect(response.predicted.poolId).toBe(
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    );
    expect(response.effectiveConfig.feeBeneficiariesSource).toBe('default');
  });

  it('rejects dynamic launches that do not use uniswapV2 migration', async () => {
    const sdk = {
      buildDynamicAuction: vi.fn(),
      getAirlockOwner: vi.fn().mockResolvedValue('0x9999999999999999999999999999999999999999'),
    };

    const chain = {
      chainId: 84532,
      config: {
        chainId: 84532,
        rpcUrl: 'http://localhost:8545',
        defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
        auctionTypes: ['multicurve', 'dynamic'],
        migrationModes: ['noOp', 'uniswapV2'],
        governanceModes: ['noOp'],
        governanceEnabled: false,
      },
      addresses: {
        airlock: '0x0000000000000000000000000000000000000001',
        weth: '0x4200000000000000000000000000000000000006',
      },
      publicClient: {
        simulateContract: vi.fn().mockResolvedValue({ request: { to: '0xairlock' } }),
      },
      walletClient: {
        account: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      },
    };

    const input: CreateDynamicLaunchRequestInput = {
      chainId: 84532,
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Dynamic', symbol: 'DYN', tokenURI: 'ipfs://token' },
      tokenomics: {
        totalSupply: '1000',
      },
      migration: { type: 'noOp' },
      governance: false,
      auction: {
        type: 'dynamic',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapMinUsd: 50,
          minProceeds: '0.01',
          maxProceeds: '0.1',
        },
      },
    };

    await expect(
      createDynamicLaunch({
        input,
        chain: chain as any,
        sdkRegistry: {
          get: vi.fn().mockReturnValue(sdk),
        } as any,
        pricingService: {
          resolveNumerairePriceUsd: vi.fn().mockResolvedValue(3000),
        } as any,
        txSubmitter: {
          submitCreateTx: vi.fn(),
        } as any,
      }),
    ).rejects.toThrow(/dynamic launches require migration\.type="uniswapV2"/i);
  });
});
