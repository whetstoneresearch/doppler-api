import { describe, expect, it, vi } from 'vitest';

import { createMulticurveLaunch } from '../../src/modules/auctions/multicurve/service';
import type { CreateMulticurveLaunchRequestInput } from '../../src/modules/launches/schema';

describe('multicurve launch service', () => {
  it('maps governance=true to SDK default governance', async () => {
    const builder = {
      tokenConfig: vi.fn().mockReturnThis(),
      saleConfig: vi.fn().mockReturnThis(),
      withIntegrator: vi.fn().mockReturnThis(),
      withVesting: vi.fn().mockReturnThis(),
      withMarketCapPresets: vi.fn().mockReturnThis(),
      withCurves: vi.fn().mockReturnThis(),
      withSchedule: vi.fn().mockReturnThis(),
      withDecay: vi.fn().mockReturnThis(),
      withRehypeDopplerHook: vi.fn().mockReturnThis(),
      withGovernance: vi.fn().mockReturnThis(),
      withMigration: vi.fn().mockReturnThis(),
      withUserAddress: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ pool: { fee: 20_000 } }),
    };

    const simulation = {
      createParams: { salt: '0x04' },
      tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      poolId: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      gasEstimate: 111n,
    };

    const sdk = {
      buildMulticurveAuction: vi.fn(() => builder),
      getAirlockOwner: vi.fn().mockResolvedValue('0x9999999999999999999999999999999999999999'),
      factory: {
        simulateCreateMulticurve: vi.fn().mockResolvedValue(simulation),
      },
    };

    const chain = {
      chainId: 84532,
      config: {
        chainId: 84532,
        rpcUrl: 'http://localhost:8545',
        defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
        auctionTypes: ['multicurve'],
        migrationModes: ['noOp'],
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

    const input: CreateMulticurveLaunchRequestInput = {
      chainId: 84532,
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Multicurve', symbol: 'MLT', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000', tokensForSale: '1000' },
      governance: true,
      migration: { type: 'noOp' },
      auction: {
        type: 'multicurve',
        curveConfig: { type: 'preset', presets: ['medium'] },
      },
    };

    await createMulticurveLaunch({
      input,
      chain: chain as any,
      sdkRegistry: { get: vi.fn().mockReturnValue(sdk) } as any,
      pricingService: { resolveNumerairePriceUsd: vi.fn().mockResolvedValue(3000) } as any,
      txSubmitter: {
        submitCreateTx: vi
          .fn()
          .mockResolvedValue('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      } as any,
    });

    expect(builder.withGovernance).toHaveBeenCalledWith({ type: 'default' });
    expect(builder.withMigration).toHaveBeenCalledWith({ type: 'noOp' });
  });
});
