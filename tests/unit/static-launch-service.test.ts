import { describe, expect, it, vi } from 'vitest';

import {
  createStaticLaunch,
  STATIC_MARKET_CAP_PRESETS,
} from '../../src/modules/auctions/static/service';
import type { CreateStaticLaunchRequestInput } from '../../src/modules/launches/schema';

describe('static launch service', () => {
  it('maps static preset market cap and lockable beneficiaries into SDK builder', async () => {
    const builder = {
      tokenConfig: vi.fn().mockReturnThis(),
      saleConfig: vi.fn().mockReturnThis(),
      withMarketCapRange: vi.fn().mockReturnThis(),
      withBeneficiaries: vi.fn().mockReturnThis(),
      withIntegrator: vi.fn().mockReturnThis(),
      withVesting: vi.fn().mockReturnThis(),
      withGovernance: vi.fn().mockReturnThis(),
      withMigration: vi.fn().mockReturnThis(),
      withUserAddress: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ any: 'params' }),
    };

    const simulation = {
      createParams: { salt: '0x01' },
      asset: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      pool: '0xcccccccccccccccccccccccccccccccccccccccc',
      gasEstimate: 123n,
    };

    const sdk = {
      buildStaticAuction: vi.fn(() => builder),
      getAirlockOwner: vi.fn().mockResolvedValue('0x9999999999999999999999999999999999999999'),
      factory: {
        simulateCreateStaticAuction: vi.fn().mockResolvedValue(simulation),
      },
    };

    const chain = {
      chainId: 84532,
      config: {
        chainId: 84532,
        rpcUrl: 'http://localhost:8545',
        defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
        auctionTypes: ['multicurve', 'static'],
        migrationModes: ['noOp'],
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

    const pricingService = {
      resolveNumerairePriceUsd: vi.fn().mockResolvedValue(3000),
    };

    const txSubmitter = {
      submitCreateTx: vi
        .fn()
        .mockResolvedValue('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    };

    const input: CreateStaticLaunchRequestInput = {
      chainId: 84532,
      userAddress: '0x1111111111111111111111111111111111111111',
      integrationAddress: '0x2222222222222222222222222222222222222222',
      tokenMetadata: { name: 'Static', symbol: 'STC', tokenURI: 'ipfs://token' },
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '800',
      },
      migration: { type: 'noOp' },
      governance: false,
      auction: {
        type: 'static',
        curveConfig: {
          type: 'preset',
          preset: 'medium',
        },
      },
    };

    const response = await createStaticLaunch({
      input,
      chain: chain as any,
      sdkRegistry: {
        get: vi.fn().mockReturnValue(sdk),
      } as any,
      pricingService: pricingService as any,
      txSubmitter: txSubmitter as any,
    });

    expect(sdk.buildStaticAuction).toHaveBeenCalled();
    expect(builder.withMarketCapRange).toHaveBeenCalledWith(
      expect.objectContaining({
        marketCap: STATIC_MARKET_CAP_PRESETS.medium,
        numerairePrice: 3000,
      }),
    );
    expect(builder.withIntegrator).toHaveBeenCalledWith(
      '0x2222222222222222222222222222222222222222',
    );
    expect(builder.withMigration).toHaveBeenCalledWith({ type: 'noOp' });
    expect(builder.withVesting).toHaveBeenCalledTimes(1);

    const passedBeneficiaries = builder.withBeneficiaries.mock.calls[0]?.[0] as Array<{
      beneficiary: string;
      shares: bigint;
    }>;
    expect(passedBeneficiaries).toHaveLength(2);
    expect(passedBeneficiaries.map((entry) => entry.beneficiary.toLowerCase())).toEqual([
      '0x1111111111111111111111111111111111111111',
      '0x9999999999999999999999999999999999999999',
    ]);

    expect(txSubmitter.submitCreateTx).toHaveBeenCalledWith(
      expect.objectContaining({
        gasEstimate: 123n,
      }),
    );
    expect(response.predicted.poolId).toBe(
      '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
    );
    expect(response.effectiveConfig.feeBeneficiariesSource).toBe('default');
  });

  it('maps static explicit market cap range starting at $100', async () => {
    const builder = {
      tokenConfig: vi.fn().mockReturnThis(),
      saleConfig: vi.fn().mockReturnThis(),
      withMarketCapRange: vi.fn().mockReturnThis(),
      withBeneficiaries: vi.fn().mockReturnThis(),
      withIntegrator: vi.fn().mockReturnThis(),
      withVesting: vi.fn().mockReturnThis(),
      withGovernance: vi.fn().mockReturnThis(),
      withMigration: vi.fn().mockReturnThis(),
      withUserAddress: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ any: 'params' }),
    };

    const simulation = {
      createParams: { salt: '0x02' },
      asset: '0xdddddddddddddddddddddddddddddddddddddddd',
      pool: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      gasEstimate: 456n,
    };

    const sdk = {
      buildStaticAuction: vi.fn(() => builder),
      getAirlockOwner: vi.fn().mockResolvedValue('0x9999999999999999999999999999999999999999'),
      factory: {
        simulateCreateStaticAuction: vi.fn().mockResolvedValue(simulation),
      },
    };

    const chain = {
      chainId: 84532,
      config: {
        chainId: 84532,
        rpcUrl: 'http://localhost:8545',
        defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
        auctionTypes: ['multicurve', 'static'],
        migrationModes: ['noOp'],
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

    const pricingService = {
      resolveNumerairePriceUsd: vi.fn().mockResolvedValue(3000),
    };

    const txSubmitter = {
      submitCreateTx: vi
        .fn()
        .mockResolvedValue('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    };

    const input: CreateStaticLaunchRequestInput = {
      chainId: 84532,
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Static', symbol: 'STC', tokenURI: 'ipfs://token' },
      tokenomics: {
        totalSupply: '1000',
      },
      migration: { type: 'noOp' },
      governance: false,
      auction: {
        type: 'static',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapEndUsd: 250000,
        },
      },
    };

    await createStaticLaunch({
      input,
      chain: chain as any,
      sdkRegistry: {
        get: vi.fn().mockReturnValue(sdk),
      } as any,
      pricingService: pricingService as any,
      txSubmitter: txSubmitter as any,
    });

    expect(builder.withMarketCapRange).toHaveBeenCalledWith(
      expect.objectContaining({
        marketCap: {
          start: 100,
          end: 250000,
        },
        numerairePrice: 3000,
      }),
    );
  });
});
