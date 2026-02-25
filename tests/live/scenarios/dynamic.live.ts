import { privateKeyToAccount } from 'viem/accounts';

import { loadConfig } from '../../../src/core/config';
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
    ['dynamic', 'fees'],
    async () => {
      const randomFeePercent = randomFeePercentTwoDecimals();
      const randomFeeUnits = percentToFeeUnits(randomFeePercent);
      const feeBeneficiaries = buildRandomFeeBeneficiaries(
        privateKeyToAccount(loadConfig().privateKey).address,
      );
      await runDynamicLaunchAndVerify({
        configLabel: `DYNAMIC V4 Custom Fee (${randomFeePercent.toFixed(2)}%)`,
        marketCapStartUsd: 100,
        marketCapMinUsd: 50,
        minProceeds: '0.01',
        maxProceeds: '0.1',
        durationSeconds: 24 * 60 * 60,
        fee: randomFeeUnits,
        tickSpacing: 10,
        feeBeneficiaries,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC V4 Random Fee + Beneficiaries ($12345->$123, min 1, max 10, 13m)',
    ['dynamic', 'fees', 'migration-v4'],
    async () => {
      const randomFeePercent = randomFeePercentTwoDecimals();
      const randomFeeUnits = percentToFeeUnits(randomFeePercent);
      const feeBeneficiaries = buildRandomFeeBeneficiaries(
        privateKeyToAccount(loadConfig().privateKey).address,
      );
      await runDynamicLaunchAndVerify({
        configLabel: `DYNAMIC V4 Random Fee + Beneficiaries (${randomFeePercent.toFixed(2)}%, $12345->$123, 13m)`,
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
        feeBeneficiaries,
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC Migration via UniswapV2',
    ['dynamic', 'migration-v2'],
    async () => {
      await runDynamicLaunchAndVerify({
        configLabel: 'DYNAMIC V4 Migration (uniswapV2)',
        migrationType: 'uniswapV2',
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
    'DYNAMIC Migration via UniswapV4',
    ['dynamic', 'migration-v4'],
    async () => {
      await runDynamicLaunchAndVerify({
        configLabel: 'DYNAMIC V4 Migration (uniswapV4)',
        migrationType: 'uniswapV4',
        migrationFee: 10_000,
        migrationTickSpacing: 200,
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
    'DYNAMIC V4 (Range $100->$50, min 0.01, max 0.1, 24h)',
    ['dynamic'],
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
    ['dynamic'],
    async () => {
      const randomSalePercent = 30 + Math.floor(Math.random() * 21);
      const tokensForSale = calculateSaleAmount(DEFAULT_LIVE_TOTAL_SUPPLY, randomSalePercent);
      const allocationAmount = DEFAULT_LIVE_TOTAL_SUPPLY - tokensForSale;
      const recipientCount = 3 + Math.floor(Math.random() * 3);
      const allocations = buildRandomAddressAllocations(allocationAmount, recipientCount);

      await runDynamicLaunchAndVerify({
        configLabel: `DYNAMIC V4 Random Split (${recipientCount} recipients, ${randomSalePercent}% market)`,
        salePercent: randomSalePercent,
        allocations: {
          mode: 'vest',
          durationSeconds: 60 * 24 * 60 * 60,
          recipients: allocations,
        },
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
    ['dynamic', 'governance'],
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
