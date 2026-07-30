import { privateKeyToAccount } from 'viem/accounts';

import { loadConfig } from '../../../src/core/config';
import { EVM_LIVE_SCENARIO_GROUPS as groups } from '../scenario-metadata';
import {
  DEFAULT_LIVE_TOTAL_SUPPLY,
  buildRandomAddressAllocations,
  buildRandomFeeBeneficiaries,
  calculateSaleAmount,
  liveIt,
  runStaticLaunchAndVerify,
} from '../helpers/live-support';

export const registerStaticLiveScenarios = () => {
  liveIt(
    'STATIC V3 Custom Fee (Random 0.10%-10.00%, supported tier)',
    groups.staticCustomFee,
    async () => {
      const supportedStaticFees = [3_000, 10_000] as const;
      const selectedFee =
        supportedStaticFees[Math.floor(Math.random() * supportedStaticFees.length)]!;
      const poolFeeBeneficiaries = buildRandomFeeBeneficiaries(
        privateKeyToAccount(loadConfig().privateKey).address,
      );
      await runStaticLaunchAndVerify({
        configLabel: `STATIC V3 Custom Fee (${(selectedFee / 10000).toFixed(2)}%)`,
        poolFeeBeneficiaries,
        curveConfig: {
          type: 'preset',
          preset: 'medium',
          fee: selectedFee,
        },
      });
    },
    240_000,
  );

  liveIt(
    'STATIC V3 Lockable (MEDIUM preset)',
    groups.staticPreset,
    async () => {
      await runStaticLaunchAndVerify({
        curveConfig: { type: 'preset', preset: 'medium' },
      });
    },
    240_000,
  );

  liveIt(
    'STATIC V3 Lockable (Range $100-$100000)',
    groups.staticRange,
    async () => {
      await runStaticLaunchAndVerify({
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapEndUsd: 100000,
        },
      });
    },
    240_000,
  );

  liveIt(
    'STATIC V3 Random 30-50% Sale + Random 3-5 Address Allocation Split',
    groups.staticVesting,
    async () => {
      const randomSalePercent = 30 + Math.floor(Math.random() * 21);
      const tokensForSale = calculateSaleAmount(DEFAULT_LIVE_TOTAL_SUPPLY, randomSalePercent);
      const allocationAmount = DEFAULT_LIVE_TOTAL_SUPPLY - tokensForSale;
      const recipientCount = 3 + Math.floor(Math.random() * 3);
      const allocations = buildRandomAddressAllocations(allocationAmount, recipientCount);

      await runStaticLaunchAndVerify({
        configLabel: `STATIC V3 Random Split (${recipientCount} recipients, ${randomSalePercent}% market)`,
        salePercent: randomSalePercent,
        allocations: allocations.map((allocation, index) => ({
          recipientAddress: allocation.address,
          amount: allocation.amount,
          durationSeconds: (60 + index * 30) * 24 * 60 * 60,
        })),
        curveConfig: { type: 'preset', preset: 'medium' },
      });
    },
    240_000,
  );

  liveIt(
    'STATIC V3 Governance Enabled (Random Preset)',
    groups.staticGovernance,
    async () => {
      const presets: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
      const preset = presets[Math.floor(Math.random() * presets.length)]!;
      await runStaticLaunchAndVerify({
        configLabel: `STATIC V3 Governance Enabled (${preset.toUpperCase()} preset)`,
        governance: true,
        curveConfig: {
          type: 'preset',
          preset,
        },
      });
    },
    240_000,
  );
};
