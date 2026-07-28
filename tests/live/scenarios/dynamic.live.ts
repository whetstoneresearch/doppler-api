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
  runDynamicLaunchAndVerify,
} from '../helpers/live-support';

export const registerDynamicLiveScenarios = () => {
  liveIt(
    'DYNAMIC V4 Custom Fee (Random 0.10%-10.00%)',
    groups.dynamicCustomFee,
    async () => {
      const randomFeePercent = randomFeePercentTwoDecimals();
      const randomFeeUnits = percentToFeeUnits(randomFeePercent);
      const poolFeeBeneficiaries = buildRandomFeeBeneficiaries(
        privateKeyToAccount(loadConfig().privateKey).address,
      );
      await runDynamicLaunchAndVerify({
        configLabel: `DYNAMIC V4 Custom Fee (${randomFeePercent.toFixed(2)}%)`,
        migrationType: 'uniswapV4',
        marketCapStartUsd: 100,
        marketCapMinUsd: 50,
        minProceeds: '0.01',
        maxProceeds: '0.1',
        durationSeconds: 24 * 60 * 60,
        fee: randomFeeUnits,
        tickSpacing: 10,
        poolFeeBeneficiaries,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC V4 Random Fee + Beneficiaries ($12345->$123, min 1, max 10, 13m)',
    groups.dynamicHookBeneficiaries,
    async () => {
      const randomFeePercent = randomFeePercentTwoDecimals();
      const randomFeeUnits = percentToFeeUnits(randomFeePercent);
      const poolFeeBeneficiaries = buildRandomFeeBeneficiaries(
        privateKeyToAccount(loadConfig().privateKey).address,
      );
      await runDynamicLaunchAndVerify({
        configLabel: `DYNAMIC Uniswap V4 Random Fee + Beneficiaries (${randomFeePercent.toFixed(2)}%, $12345->$123, 13m)`,
        migrationType: 'uniswapV4',
        migrationFee: 10_000,
        migrationTickSpacing: 200,
        marketCapStartUsd: 12_345,
        marketCapMinUsd: 123,
        minProceeds: '1',
        maxProceeds: '10',
        durationSeconds: 13 * 60,
        epochLengthSeconds: 60,
        fee: randomFeeUnits,
        tickSpacing: 10,
        poolFeeBeneficiaries,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC Migration via UniswapV2',
    groups.dynamicUniswapV2,
    async () => {
      await runDynamicLaunchAndVerify({
        configLabel: 'DYNAMIC V4 Migration (uniswapV2)',
        migrationType: 'uniswapV2',
        marketCapStartUsd: 100,
        marketCapMinUsd: 50,
        minProceeds: '0.01',
        maxProceeds: '0.1',
        durationSeconds: 36 * 60 * 60,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC Migration to Uniswap V4',
    groups.dynamicUniswapV4,
    async () => {
      await runDynamicLaunchAndVerify({
        configLabel: 'DYNAMIC Uniswap V4 Migration',
        migrationType: 'uniswapV4',
        migrationFee: 10_000,
        migrationTickSpacing: 200,
        marketCapStartUsd: 100,
        marketCapMinUsd: 50,
        minProceeds: '0.01',
        maxProceeds: '0.1',
        durationSeconds: 48 * 60 * 60,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC Migration to Rehype Uniswap V4',
    groups.dynamicRehypeUniswapV4,
    async () => {
      const userAddress = privateKeyToAccount(loadConfig().privateKey).address;
      await runDynamicLaunchAndVerify({
        configLabel: 'DYNAMIC Rehype Uniswap V4 Migration',
        migrationType: 'uniswapV4',
        migrationFee: 3_000,
        migrationTickSpacing: 60,
        rehype: {
          buybackDestination: userAddress,
          customFee: 10_000,
          feeRoutingMode: 'routeToBeneficiaryFees',
          feeDistributionInfo: {
            assetFeesToAssetBuybackWad: '500000000000000000',
            assetFeesToNumeraireBuybackWad: '500000000000000000',
            assetFeesToBeneficiaryWad: '0',
            assetFeesToLpWad: '0',
            numeraireFeesToAssetBuybackWad: '0',
            numeraireFeesToNumeraireBuybackWad: '250000000000000000',
            numeraireFeesToBeneficiaryWad: '250000000000000000',
            numeraireFeesToLpWad: '500000000000000000',
          },
        },
        marketCapStartUsd: 100,
        marketCapMinUsd: 50,
        minProceeds: '0.01',
        maxProceeds: '0.1',
        durationSeconds: 60 * 60 * 60,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC V4 (Range $100->$50, min 0.01, max 0.1, 24h)',
    groups.dynamicRange,
    async () => {
      await runDynamicLaunchAndVerify({
        marketCapStartUsd: 100,
        marketCapMinUsd: 50,
        minProceeds: '0.01',
        maxProceeds: '0.1',
        durationSeconds: 24 * 60 * 60,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC V4 Random 30-50% Sale + Random 3-5 Address Allocation Split',
    groups.dynamicVesting,
    async () => {
      const randomSalePercent = 30 + Math.floor(Math.random() * 21);
      const tokensForSale = calculateSaleAmount(DEFAULT_LIVE_TOTAL_SUPPLY, randomSalePercent);
      const allocationAmount = DEFAULT_LIVE_TOTAL_SUPPLY - tokensForSale;
      const recipientCount = 3 + Math.floor(Math.random() * 3);
      const allocations = buildRandomAddressAllocations(allocationAmount, recipientCount);

      await runDynamicLaunchAndVerify({
        configLabel: `DYNAMIC V4 Random Split (${recipientCount} recipients, ${randomSalePercent}% market)`,
        salePercent: randomSalePercent,
        allocations: allocations.map((allocation, index) => ({
          recipientAddress: allocation.address,
          amount: allocation.amount,
          durationSeconds: (60 + index * 30) * 24 * 60 * 60,
        })),
        marketCapStartUsd: 100,
        marketCapMinUsd: 50,
        minProceeds: '0.01',
        maxProceeds: '0.1',
        durationSeconds: 24 * 60 * 60,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC V4 Governance Enabled (Random Range/Proceeds)',
    groups.dynamicGovernance,
    async () => {
      const marketCapStartUsd = 100 + Math.floor(Math.random() * 901);
      const minGapUsd = 20 + Math.floor(Math.random() * 181);
      const marketCapMinUsd = Math.max(1, marketCapStartUsd - minGapUsd);
      const minProceedsEth = 0.01 + Math.random() * 0.04;
      const maxMultiplier = 2 + Math.random() * 4;
      const maxProceedsEth = minProceedsEth * maxMultiplier;
      const durationSeconds = (6 + Math.floor(Math.random() * 19)) * 60 * 60;
      const epochLengthSeconds = 60 * 60;

      await runDynamicLaunchAndVerify({
        configLabel: `DYNAMIC V4 Governance Enabled (start $${marketCapStartUsd}, min $${marketCapMinUsd}, proceeds ${minProceedsEth.toFixed(4)}-${maxProceedsEth.toFixed(4)}, ${durationSeconds}s, epoch ${epochLengthSeconds}s)`,
        governance: true,
        marketCapStartUsd,
        marketCapMinUsd,
        minProceeds: minProceedsEth.toFixed(4),
        maxProceeds: maxProceedsEth.toFixed(4),
        durationSeconds,
        epochLengthSeconds,
      });
    },
    240_000,
  );
};
