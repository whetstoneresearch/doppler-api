import { WAD } from '@whetstone-research/doppler-sdk/evm';
import { privateKeyToAccount } from 'viem/accounts';

import { loadConfig } from '../../../src/core/config';
import { EVM_LIVE_SCENARIO_GROUPS as groups } from '../scenario-metadata';
import {
  DEFAULT_LIVE_TOTAL_SUPPLY,
  buildRandomAddressAllocations,
  buildRandomFeeBeneficiaries,
  calculateSaleAmount,
  liveIt,
  percentToFeeUnits,
  randomFeePercentTwoDecimals,
  runCustomCurveLaunchAndVerify,
  runCustomCurveWithRandomVestingAndAllocations,
  runMulticurveLaunchAndVerify,
} from '../helpers/live-support';

export const registerMulticurveLiveScenarios = () => {
  liveIt(
    'LOW Default Configuration',
    groups.multicurveLowDefault,
    async () => {
      await runMulticurveLaunchAndVerify('low');
    },
    240_000,
  );

  liveIt(
    'MEDIUM Default Configuration',
    groups.multicurveMediumDefault,
    async () => {
      await runMulticurveLaunchAndVerify('medium');
    },
    240_000,
  );

  liveIt(
    'HIGH Default Configuration',
    groups.multicurveHighDefault,
    async () => {
      await runMulticurveLaunchAndVerify('high');
    },
    240_000,
  );

  liveIt(
    'MULTICURVE Custom Fee (Random 0.10%-10.00%)',
    groups.multicurveCustomFee,
    async () => {
      const randomFeePercent = randomFeePercentTwoDecimals();
      const randomFeeUnits = percentToFeeUnits(randomFeePercent);
      const poolFeeBeneficiaries = buildRandomFeeBeneficiaries(
        privateKeyToAccount(loadConfig().privateKey).address,
      );
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MULTICURVE Custom Fee (${randomFeePercent.toFixed(2)}%)`,
        poolFeeBeneficiaries,
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
    groups.multicurveDefaultVesting,
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
    groups.multicurveExplicitVesting,
    async () => {
      const randomSalePercent = 30 + Math.floor(Math.random() * 21);
      const userAddress = privateKeyToAccount(loadConfig().privateKey).address;
      const tokensForSale = calculateSaleAmount(DEFAULT_LIVE_TOTAL_SUPPLY, randomSalePercent);
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Random ${randomSalePercent}% Sale / ${100 - randomSalePercent}% Allocation`,
        salePercent: randomSalePercent,
        allocations: [
          {
            recipientAddress: userAddress,
            amount: (DEFAULT_LIVE_TOTAL_SUPPLY - tokensForSale).toString(),
            durationSeconds: 45 * 24 * 60 * 60,
          },
        ],
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Random 3-5 Address Allocation Split',
    groups.multicurveMultipleVesting,
    async () => {
      const randomSalePercent = 20 + Math.floor(Math.random() * 31);
      const tokensForSale = calculateSaleAmount(DEFAULT_LIVE_TOTAL_SUPPLY, randomSalePercent);
      const allocationAmount = DEFAULT_LIVE_TOTAL_SUPPLY - tokensForSale;
      const recipientCount = 3 + Math.floor(Math.random() * 3);
      const allocations = buildRandomAddressAllocations(allocationAmount, recipientCount);

      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Random Split (${recipientCount} recipients, ${randomSalePercent}% market)`,
        salePercent: randomSalePercent,
        allocations: allocations.map((allocation, index) => ({
          recipientAddress: allocation.address,
          amount: allocation.amount,
          durationSeconds: (60 + index * 30) * 24 * 60 * 60,
        })),
      });
    },
    240_000,
  );

  liveIt(
    'Custom Curve Configuration',
    groups.multicurveCustomCurve,
    async () => {
      await runCustomCurveLaunchAndVerify();
    },
    240_000,
  );

  liveIt(
    'Custom Curve + Random Vesting (91-364d) + Random Allocations',
    groups.multicurveRandomCurveAndVesting,
    async () => {
      await runCustomCurveWithRandomVestingAndAllocations();
    },
    240_000,
  );

  liveIt(
    'MEDIUM Rehype Initializer (Three Fee Beneficiaries, 80/20)',
    groups.multicurveRehype,
    async () => {
      const startFee = 500 + Math.floor(Math.random() * 50_001);

      await runMulticurveLaunchAndVerify('medium', {
        configLabel: 'MEDIUM Rehype Initializer (three fee beneficiaries)',
        salePercent: 80,
        initializer: {
          type: 'rehype',
          config: {
            rehypeFeeBeneficiaries: [
              {
                address: '0x1111111111111111111111111111111111111111',
                sharesWad: '200000000000000000',
              },
              {
                address: '0x2222222222222222222222222222222222222222',
                sharesWad: '300000000000000000',
              },
              {
                address: '0x3333333333333333333333333333333333333333',
                sharesWad: '500000000000000000',
              },
            ],
            startFee,
            feeDistributionInfo: {
              assetFeesToAssetBuybackWad: '0',
              assetFeesToNumeraireBuybackWad: '0',
              assetFeesToBeneficiaryWad: WAD.toString(),
              assetFeesToLpWad: '0',
              numeraireFeesToAssetBuybackWad: '0',
              numeraireFeesToNumeraireBuybackWad: '0',
              numeraireFeesToBeneficiaryWad: WAD.toString(),
              numeraireFeesToLpWad: '0',
            },
          },
        },
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Governance Enabled (Random 60-90% Sale)',
    groups.multicurveGovernance,
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
};
