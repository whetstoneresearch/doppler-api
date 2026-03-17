import { afterAll, beforeAll, describe } from 'vitest';
import { formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { buildServices } from '../../src/app/server';
import { loadConfig } from '../../src/core/config';
import { buildLiveBalanceRequirement, LIVE_READINESS_ERROR_MARKER } from './readiness-check';
import {
  launchSummaries,
  liveFilter,
  liveVerbose,
  printLiveMatrix,
  runLive,
  toShortError,
} from './helpers/live-support';
import { registerDynamicLiveScenarios } from './scenarios/dynamic.live';
import { registerMulticurveLiveScenarios } from './scenarios/multicurve.live';
import { registerStaticLiveScenarios } from './scenarios/static.live';

describe('live create verification', () => {
  beforeAll(async () => {
    if (!runLive) return;

    const config = loadConfig();
    const services = buildServices(config);
    const chain = services.chainRegistry.get(config.defaultChainId);
    const signerAddress = privateKeyToAccount(config.privateKey).address;
    let requirement: ReturnType<typeof buildLiveBalanceRequirement>;

    try {
      requirement = buildLiveBalanceRequirement({
        liveFilter,
        minBalanceEth: process.env.LIVE_TEST_MIN_BALANCE_ETH,
        estimatedTxCostEth: process.env.LIVE_TEST_ESTIMATED_TX_COST_ETH,
        estimatedOverheadEth: process.env.LIVE_TEST_ESTIMATED_OVERHEAD_ETH,
      });
    } catch (error) {
      throw new Error(
        `[${LIVE_READINESS_ERROR_MARKER}] Invalid live test readiness configuration: ${toShortError(error)}.`,
        { cause: error as Error },
      );
    }

    if (!requirement) return;

    let signerBalance: bigint;
    try {
      signerBalance = await chain.publicClient.getBalance({ address: signerAddress });
    } catch (error) {
      throw new Error(
        `[${LIVE_READINESS_ERROR_MARKER}] Could not fetch balance for signer ${signerAddress} on chain ${chain.chainId} (${chain.config.rpcUrl}). Ensure the chain rpcUrl in doppler.config.ts (or RPC_URL override) is reachable before running live tests.`,
        { cause: error as Error },
      );
    }

    if (signerBalance < requirement.requiredWei) {
      throw new Error(
        `[${LIVE_READINESS_ERROR_MARKER}] Insufficient estimated balance for LIVE_TEST_FILTER=${liveFilter}. Signer ${signerAddress} on chain ${chain.chainId} has ${formatEther(signerBalance)} ETH, but requires at least ${formatEther(requirement.requiredWei)} ETH (${requirement.reason}). Fund this signer or adjust LIVE_TEST_MIN_BALANCE_ETH / LIVE_TEST_ESTIMATED_TX_COST_ETH / LIVE_TEST_ESTIMATED_OVERHEAD_ETH.`,
      );
    }
  });

  afterAll(async () => {
    printLiveMatrix(
      'Launch Summary',
      [
        'Configuration',
        'Result',
        'Sale %',
        'Allocation Amount',
        'Recipients',
        'Vest Mode',
        'Vest Duration (s)',
        'Pure URL',
      ],
      launchSummaries.map((row) => [
        row.config,
        row.status,
        row.salePercent ?? 'n/a',
        row.allocationAmount ?? 'n/a',
        row.allocationRecipients ?? 'n/a',
        row.vestMode ?? 'n/a',
        row.vestDuration ?? 'n/a',
        row.pureUrl ?? (row.status === 'failed' ? `n/a (${row.reason ?? 'launch failed'})` : 'n/a'),
      ]),
    );

    const failedLaunches = launchSummaries.filter((row) => row.status === 'failed');
    if (liveVerbose && failedLaunches.length > 0) {
      printLiveMatrix(
        'Failed Launches',
        ['Configuration', 'Submitted Tx', 'Reason'],
        failedLaunches.map((row) => [row.config, row.txHash ?? 'n/a', row.reason ?? 'unknown']),
      );
    }
  });

  registerMulticurveLiveScenarios();
  registerStaticLiveScenarios();
  registerDynamicLiveScenarios();
});
