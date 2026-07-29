// allow: SIZE_OK — static launch behavior needs canonical, range, governance, and fail-fast assertions.
import { describe, expect, it, vi } from 'vitest';

import {
  createStaticLaunch,
  STATIC_MARKET_CAP_PRESETS,
} from '../../src/modules/auctions/static/service';
import type { CreateStaticLaunchRequestInput } from '../../src/modules/launches/schema';

describe('static launch service', () => {
  it('builds canonical LockableUniswapV3Initializer static launch data', async () => {
    const builder = {
      tokenConfig: vi.fn().mockReturnThis(),
      saleConfig: vi.fn().mockReturnThis(),
      withMarketCapRange: vi.fn().mockReturnThis(),
      withBeneficiaries: vi.fn().mockReturnThis(),
      withV3Initializer: vi.fn().mockReturnThis(),
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
        governanceModes: ['noOp', 'default', 'custom'],
        governanceEnabled: true,
      },
      addresses: {
        airlock: '0x0000000000000000000000000000000000000001',
        weth: '0x4200000000000000000000000000000000000006',
        lockableV3Initializer: '0x0000000000000000000000000000000000000007',
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
      tokenMetadata: {
        name: 'Static',
        symbol: 'STC',
        tokenURI: 'ipfs://token',
        maxBalanceLimit: '400',
        balanceLimitEnd: 86_400,
        balanceController: '0x3333333333333333333333333333333333333333',
        excludedFromBalanceLimit: ['0x4444444444444444444444444444444444444444'],
      },
      economics: {
        totalSupply: '1000',
        tokensForSale: '800',
        allocations: [
          {
            recipientAddress: '0x5555555555555555555555555555555555555555',
            amount: '120',
            durationSeconds: 86_400,
            cliffDurationSeconds: 10,
          },
          {
            recipientAddress: '0x6666666666666666666666666666666666666666',
            amount: '80',
            durationSeconds: 172_800,
            cliffDurationSeconds: 20,
          },
        ],
      },
      poolFeeBeneficiaries: [
        { address: '0x1111111111111111111111111111111111111111', sharesWad: '950000000000000000' },
        { address: '0x9999999999999999999999999999999999999999', sharesWad: '50000000000000000' },
      ],
      governance: '0x7777777777777777777777777777777777777777',
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
      chain: chain as unknown as Parameters<typeof createStaticLaunch>[0]['chain'],
      sdkRegistry: {
        get: vi.fn().mockReturnValue(sdk),
      } as unknown as Parameters<typeof createStaticLaunch>[0]['sdkRegistry'],
      pricingService: pricingService as unknown as Parameters<
        typeof createStaticLaunch
      >[0]['pricingService'],
      txSubmitter: txSubmitter as unknown as Parameters<
        typeof createStaticLaunch
      >[0]['txSubmitter'],
    });

    expect(sdk.buildStaticAuction).toHaveBeenCalled();
    expect(builder.tokenConfig).toHaveBeenCalledWith({
      type: 'dopplerERC20V1',
      name: 'Static',
      symbol: 'STC',
      tokenURI: 'ipfs://token',
      maxBalanceLimit: 400n,
      balanceLimitEnd: 86_400,
      controller: '0x3333333333333333333333333333333333333333',
      excludedFromBalanceLimit: ['0x4444444444444444444444444444444444444444'],
    });
    expect(builder.withMarketCapRange).toHaveBeenCalledWith(
      expect.objectContaining({
        marketCap: STATIC_MARKET_CAP_PRESETS.medium,
        numerairePrice: 3000,
      }),
    );
    expect(builder.withIntegrator).toHaveBeenCalledWith(
      '0x2222222222222222222222222222222222222222',
    );
    expect(builder.withV3Initializer).toHaveBeenCalledWith(
      '0x0000000000000000000000000000000000000007',
    );
    expect(builder.withMigration).toHaveBeenCalledWith({ type: 'noOp' });
    expect(builder.withGovernance).toHaveBeenCalledWith({
      type: 'launchpad',
      multisig: '0x7777777777777777777777777777777777777777',
    });
    expect(builder.withVesting).toHaveBeenCalledWith({
      allocations: [
        {
          recipient: '0x5555555555555555555555555555555555555555',
          amount: 120n,
          schedule: { duration: 86_400n, cliffDuration: 10 },
        },
        {
          recipient: '0x6666666666666666666666666666666666666666',
          amount: 80n,
          schedule: { duration: 172_800n, cliffDuration: 20 },
        },
      ],
    });

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
    expect(response.effectiveConfig.poolFeeBeneficiariesSource).toBe('request');
  });

  it('maps static explicit market cap range starting at $100', async () => {
    const builder = {
      tokenConfig: vi.fn().mockReturnThis(),
      saleConfig: vi.fn().mockReturnThis(),
      withMarketCapRange: vi.fn().mockReturnThis(),
      withBeneficiaries: vi.fn().mockReturnThis(),
      withV3Initializer: vi.fn().mockReturnThis(),
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
        governanceModes: ['noOp', 'default'],
        governanceEnabled: true,
      },
      addresses: {
        airlock: '0x0000000000000000000000000000000000000001',
        weth: '0x4200000000000000000000000000000000000006',
        lockableV3Initializer: '0x0000000000000000000000000000000000000007',
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
      economics: {
        totalSupply: '1000',
      },
      governance: true,
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
      chain: chain as unknown as Parameters<typeof createStaticLaunch>[0]['chain'],
      sdkRegistry: {
        get: vi.fn().mockReturnValue(sdk),
      } as unknown as Parameters<typeof createStaticLaunch>[0]['sdkRegistry'],
      pricingService: pricingService as unknown as Parameters<
        typeof createStaticLaunch
      >[0]['pricingService'],
      txSubmitter: txSubmitter as unknown as Parameters<
        typeof createStaticLaunch
      >[0]['txSubmitter'],
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
    expect(builder.withGovernance).toHaveBeenCalledWith({ type: 'default' });
  });

  it.each([
    { governance: false, expected: { type: 'noOp' } },
    { governance: undefined, expected: { type: 'noOp' } },
  ])('maps static governance $governance to $expected.type', async ({ governance, expected }) => {
    const builder = {
      tokenConfig: vi.fn().mockReturnThis(),
      saleConfig: vi.fn().mockReturnThis(),
      withMarketCapRange: vi.fn().mockReturnThis(),
      withBeneficiaries: vi.fn().mockReturnThis(),
      withV3Initializer: vi.fn().mockReturnThis(),
      withVesting: vi.fn().mockReturnThis(),
      withGovernance: vi.fn().mockReturnThis(),
      withMigration: vi.fn().mockReturnThis(),
      withUserAddress: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ any: 'params' }),
    };
    const input: CreateStaticLaunchRequestInput = {
      chainId: 84532,
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Static', symbol: 'STC', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000' },
      ...(governance === undefined ? {} : { governance }),
      auction: { type: 'static', curveConfig: { type: 'preset', preset: 'low' } },
    };

    await createStaticLaunch({
      input,
      chain: {
        chainId: 84532,
        config: {
          chainId: 84532,
          rpcUrl: 'http://localhost:8545',
          defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
          auctionTypes: ['static'],
          migrationModes: ['noOp'],
          governanceModes: ['noOp'],
          governanceEnabled: false,
        },
        addresses: {
          airlock: '0x0000000000000000000000000000000000000001',
          weth: '0x4200000000000000000000000000000000000006',
          lockableV3Initializer: '0x0000000000000000000000000000000000000007',
        },
        publicClient: {
          simulateContract: vi.fn().mockResolvedValue({ request: { to: '0xairlock' } }),
        },
        walletClient: { account: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
      } as unknown as Parameters<typeof createStaticLaunch>[0]['chain'],
      sdkRegistry: {
        get: vi.fn().mockReturnValue({
          buildStaticAuction: vi.fn().mockReturnValue(builder),
          getAirlockOwner: vi.fn().mockResolvedValue('0x1111111111111111111111111111111111111111'),
          factory: {
            simulateCreateStaticAuction: vi.fn().mockResolvedValue({
              createParams: { salt: '0x03' },
              asset: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              pool: '0xcccccccccccccccccccccccccccccccccccccccc',
            }),
          },
        }),
      } as unknown as Parameters<typeof createStaticLaunch>[0]['sdkRegistry'],
      pricingService: {
        resolveNumerairePriceUsd: vi.fn().mockResolvedValue(3_000),
      } as unknown as Parameters<typeof createStaticLaunch>[0]['pricingService'],
      txSubmitter: {
        submitCreateTx: vi
          .fn()
          .mockResolvedValue('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      } as unknown as Parameters<typeof createStaticLaunch>[0]['txSubmitter'],
    });

    expect(builder.withGovernance).toHaveBeenCalledWith(expected);
  });

  it('rejects missing lockable initializer before transaction submission', async () => {
    const builder = {
      tokenConfig: vi.fn().mockReturnThis(),
      saleConfig: vi.fn().mockReturnThis(),
      withMarketCapRange: vi.fn().mockReturnThis(),
      withBeneficiaries: vi.fn().mockReturnThis(),
      withVesting: vi.fn().mockReturnThis(),
      withGovernance: vi.fn().mockReturnThis(),
      withMigration: vi.fn().mockReturnThis(),
      withUserAddress: vi.fn().mockReturnThis(),
      build: vi.fn(),
    };
    const submitCreateTx = vi.fn();
    const input: CreateStaticLaunchRequestInput = {
      chainId: 84532,
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Static', symbol: 'STC', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000' },
      auction: { type: 'static', curveConfig: { type: 'preset', preset: 'low' } },
    };

    await expect(
      createStaticLaunch({
        input,
        chain: {
          chainId: 84532,
          config: {
            chainId: 84532,
            rpcUrl: 'http://localhost:8545',
            defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
            auctionTypes: ['static'],
            migrationModes: ['noOp'],
            governanceModes: ['noOp'],
            governanceEnabled: false,
          },
          addresses: {
            airlock: '0x0000000000000000000000000000000000000001',
            weth: '0x4200000000000000000000000000000000000006',
          },
          publicClient: { simulateContract: vi.fn() },
          walletClient: { account: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
        } as unknown as Parameters<typeof createStaticLaunch>[0]['chain'],
        sdkRegistry: {
          get: vi.fn().mockReturnValue({
            buildStaticAuction: vi.fn().mockReturnValue(builder),
            getAirlockOwner: vi.fn(),
            factory: { simulateCreateStaticAuction: vi.fn() },
          }),
        } as unknown as Parameters<typeof createStaticLaunch>[0]['sdkRegistry'],
        pricingService: {
          resolveNumerairePriceUsd: vi.fn(),
        } as unknown as Parameters<typeof createStaticLaunch>[0]['pricingService'],
        txSubmitter: { submitCreateTx },
      } as unknown as Parameters<typeof createStaticLaunch>[0]),
    ).rejects.toMatchObject({ statusCode: 422, code: 'LOCKABLE_V3_INITIALIZER_UNSUPPORTED' });

    expect(submitCreateTx).not.toHaveBeenCalled();
  });
});
