import { WAD } from '@whetstone-research/doppler-sdk/evm';
import { privateKeyToAccount } from 'viem/accounts';

import { buildServices } from '../../../src/app/server';
import { loadConfig } from '../../../src/core/config';
import {
  DEAD_ADDRESS,
  DEFAULT_LIVE_TOTAL_SUPPLY,
  assertNotImplementedError,
  buildRandomAddressAllocations,
  buildRandomFeeBeneficiaries,
  calculateSaleAmount,
  liveDivider,
  liveIt,
  liveVerbose,
  percentToFeeUnits,
  printLiveTable,
  randomFeePercentTwoDecimals,
  runCustomCurveLaunchAndVerify,
  runCustomCurveWithRandomVestingAndAllocations,
  runMulticurveLaunchAndVerify,
  verboseLog,
} from '../helpers/live-support';

export const registerMulticurveLiveScenarios = () => {
  liveIt(
    'LOW Default Configuration',
    ['multicurve', 'multicurve-defaults'],
    async () => {
      await runMulticurveLaunchAndVerify('low');
    },
    240_000,
  );

  liveIt(
    'MEDIUM Default Configuration',
    ['multicurve', 'multicurve-defaults'],
    async () => {
      await runMulticurveLaunchAndVerify('medium');
    },
    240_000,
  );

  liveIt(
    'HIGH Default Configuration',
    ['multicurve', 'multicurve-defaults'],
    async () => {
      await runMulticurveLaunchAndVerify('high');
    },
    240_000,
  );

  liveIt(
    'MULTICURVE Custom Fee (Random 0.10%-10.00%)',
    ['multicurve', 'fees'],
    async () => {
      const randomFeePercent = randomFeePercentTwoDecimals();
      const randomFeeUnits = percentToFeeUnits(randomFeePercent);
      const feeBeneficiaries = buildRandomFeeBeneficiaries(
        privateKeyToAccount(loadConfig().privateKey).address,
      );
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MULTICURVE Custom Fee (${randomFeePercent.toFixed(2)}%)`,
        feeBeneficiaries,
        feeConfigOverride: {
          fee: randomFeeUnits,
          expectedTickSpacing: 0,
          feePercent: `${randomFeePercent.toFixed(2)}%`,
        },
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM 20% Sale / 80% Allocation (Default Lock)',
    ['multicurve'],
    async () => {
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: 'MEDIUM 20% Sale / 80% Allocation',
        salePercent: 20,
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Random 30-50% Sale / Allocation Remainder',
    ['multicurve'],
    async () => {
      const randomSalePercent = 30 + Math.floor(Math.random() * 21);
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Random ${randomSalePercent}% Sale / ${100 - randomSalePercent}% Allocation`,
        salePercent: randomSalePercent,
        allocations: {
          mode: 'vault',
          durationSeconds: 45 * 24 * 60 * 60,
        },
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Random 3-5 Address Allocation Split',
    ['multicurve'],
    async () => {
      const randomSalePercent = 20 + Math.floor(Math.random() * 31);
      const tokensForSale = calculateSaleAmount(DEFAULT_LIVE_TOTAL_SUPPLY, randomSalePercent);
      const allocationAmount = DEFAULT_LIVE_TOTAL_SUPPLY - tokensForSale;
      const recipientCount = 3 + Math.floor(Math.random() * 3);
      const allocations = buildRandomAddressAllocations(allocationAmount, recipientCount);

      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Random Split (${recipientCount} recipients, ${randomSalePercent}% market)`,
        salePercent: randomSalePercent,
        allocations: {
          mode: 'vest',
          durationSeconds: 60 * 24 * 60 * 60,
          recipients: allocations,
        },
      });
    },
    240_000,
  );

  liveIt(
    'Custom Curve Configuration',
    ['multicurve'],
    async () => {
      await runCustomCurveLaunchAndVerify();
    },
    240_000,
  );

  liveIt(
    'Custom Curve + Random Vesting (91-364d) + Random Allocations',
    ['multicurve'],
    async () => {
      await runCustomCurveWithRandomVestingAndAllocations();
    },
    240_000,
  );

  liveIt(
    'MEDIUM Scheduled Initializer (+360s, 80/20)',
    ['multicurve'],
    async () => {
      const startTime = Math.floor(Date.now() / 1000) + 360;
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: 'MEDIUM Scheduled Initializer (+360s, 80/20)',
        salePercent: 80,
        initializer: {
          type: 'scheduled',
          startTime,
        },
      });
    },
    240_000,
  );

  liveIt(
    'HIGH Decay Initializer (Random 40-80% -> 1%, 30-90s, 80/20)',
    ['multicurve'],
    async () => {
      const startFeePercent = 40 + Math.floor(Math.random() * 41);
      const startFee = percentToFeeUnits(startFeePercent);
      const durationSeconds = 30 + Math.floor(Math.random() * 61);
      await runMulticurveLaunchAndVerify('high', {
        configLabel: `HIGH Decay Initializer (${startFeePercent}% -> 1%, ${durationSeconds}s, 80/20)`,
        salePercent: 80,
        initializer: {
          type: 'decay',
          startFee,
          durationSeconds,
        },
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Rehype Initializer (Random Config, 100% Buyback/Burn to Dead, 80/20)',
    ['multicurve'],
    async () => {
      const assetBuybackBps = 10_000;
      const assetBuybackPercentWad = ((WAD * BigInt(assetBuybackBps)) / 10_000n).toString();
      const numeraireBuybackPercentWad = (WAD - BigInt(assetBuybackPercentWad)).toString();
      const customFee = 500 + Math.floor(Math.random() * 50_001);

      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Rehype Initializer (asset buyback ${assetBuybackBps / 100}%, 80/20)`,
        salePercent: 80,
        initializer: {
          type: 'rehype',
          config: {
            buybackDestination: DEAD_ADDRESS,
            customFee,
            assetBuybackPercentWad,
            numeraireBuybackPercentWad,
            beneficiaryPercentWad: '0',
            lpPercentWad: '0',
          },
        },
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Governance Enabled (Random 60-90% Sale)',
    ['multicurve', 'governance'],
    async () => {
      const randomSalePercent = 60 + Math.floor(Math.random() * 31);
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Governance Enabled (${randomSalePercent}% Sale)`,
        salePercent: randomSalePercent,
        governance: true,
      });
    },
    240_000,
  );

  liveIt(
    'rejects unsupported migration modes as not implemented',
    ['negative'],
    async () => {
      const config = loadConfig();
      const services = buildServices(config);
      const chain = services.chainRegistry.get(config.defaultChainId);
      const userAddress = privateKeyToAccount(config.privateKey).address;

      const basePayload = {
        chainId: chain.chainId,
        userAddress,
        tokenMetadata: {
          name: `Live Planned ${Date.now()}`,
          symbol: `P${Date.now().toString().slice(-4)}`,
          tokenURI: 'ipfs://live-planned',
        },
        economics: {
          totalSupply: (1_000_000n * 10n ** 18n).toString(),
        },
        auction: {
          type: 'multicurve' as const,
          curveConfig: {
            type: 'preset' as const,
            presets: ['low' as const],
          },
        },
        pricing: {
          numerairePriceUsd: Number(process.env.LIVE_NUMERAIRE_PRICE_USD || '3000'),
        },
      };

      if (liveVerbose) {
        // eslint-disable-next-line no-console
        console.log(liveDivider('Validating unsupported migration modes'));
        printLiveTable('Expected Responses', [
          ['migration uniswapV2/uniswapV3/uniswapV4', '501 MIGRATION_NOT_IMPLEMENTED'],
        ]);
      }

      await assertNotImplementedError(
        services.launchService.createLaunch({
          ...basePayload,
          governance: { enabled: false, mode: 'noOp' },
          migration: { type: 'uniswapV3' },
        }),
        'MIGRATION_NOT_IMPLEMENTED',
      );

      await assertNotImplementedError(
        services.launchService.createLaunch({
          ...basePayload,
          governance: { enabled: false, mode: 'noOp' },
          migration: { type: 'uniswapV2' },
        }),
        'MIGRATION_NOT_IMPLEMENTED',
      );

      await assertNotImplementedError(
        services.launchService.createLaunch({
          ...basePayload,
          governance: { enabled: false, mode: 'noOp' },
          migration: { type: 'uniswapV4', fee: 10_000, tickSpacing: 100 },
        }),
        'MIGRATION_NOT_IMPLEMENTED',
      );
      verboseLog('[live] unsupported migration checks passed');
    },
    120_000,
  );
};
