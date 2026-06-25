import { randomBytes } from 'node:crypto';

import { expect } from 'vitest';
import {
  address,
  assertAccountExists,
  createSolanaRpc,
  fetchEncodedAccount,
  generateKeyPairSigner,
  signature as toSolanaSignature,
} from '@solana/kit';
import { initializer } from '@whetstone-research/doppler-sdk/solana';

import { buildServer, buildServices } from '../../../src/app/server';
import { loadConfig } from '../../../src/core/config';
import type { CreateSolanaLaunchResponse } from '../../../src/core/types';
import {
  SOLANA_CONSTANTS,
  type CreateSolanaLaunchRequestInput,
  type DedicatedSolanaCreateLaunchRequestInput,
} from '../../../src/modules/launches/solana';
import {
  launchSummaries,
  liveDivider,
  liveIt,
  liveVerbose,
  printLiveTable,
  toShortError,
} from '../helpers/live-support';

const SOLANA_LIVE_TIMEOUT_MS = 240_000;
const SOLANA_ACCOUNT_COMMITMENT = { commitment: 'confirmed' as const };
const SOLANA_NON_WSOL_ADDRESS = '11111111111111111111111111111111';
const SOLANA_LIVE_CREATE_ATTEMPTS = 2;
const SOLANA_LIVE_CREATE_RETRY_DELAY_MS = 10_000;

type SolanaLiveRoute = 'dedicated' | 'generic';
type SolanaLivePayload = DedicatedSolanaCreateLaunchRequestInput | CreateSolanaLaunchRequestInput;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const withSolanaLiveRetries = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }

  throw lastError;
};

const nextTokenMetadata = (prefix: string) => {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return {
    name: `SOL ${prefix} ${suffix}`.slice(0, 32),
    symbol: `${prefix
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase()
      .slice(0, 4)}${suffix}`.slice(0, 10),
    tokenURI: `ipfs://live-solana/${prefix.toLowerCase()}/${Date.now()}-${suffix.toLowerCase()}`,
  };
};

const nextFeeBeneficiaries = async () => {
  const beneficiary = await generateKeyPairSigner();
  return [{ address: beneficiary.address, shareBps: SOLANA_CONSTANTS.feeBpsDenominator }];
};

const parseTransientSolanaCreateFailure = (response: {
  statusCode: number;
  body: string;
  json: () => unknown;
}): string | null => {
  if (response.statusCode !== 502) {
    return null;
  }

  try {
    const body = response.json() as { error?: { code?: string; message?: string } };
    if (body.error?.code !== 'SOLANA_SUBMISSION_FAILED') {
      return null;
    }

    return body.error.message ?? response.body;
  } catch {
    return response.body;
  }
};

const createLiveApp = async () => {
  const config = loadConfig();
  return {
    config,
    app: await buildServer(buildServices(config)),
  };
};

const assertSolanaAccountExists = async (
  rpc: ReturnType<typeof createSolanaRpc>,
  accountAddress: string,
): Promise<void> => {
  const account = await withSolanaLiveRetries(() =>
    fetchEncodedAccount(rpc, address(accountAddress), SOLANA_ACCOUNT_COMMITMENT),
  );
  assertAccountExists(account);
};

const waitForConfirmedSignature = async (
  rpc: ReturnType<typeof createSolanaRpc>,
  signature: string,
): Promise<void> => {
  const submittedSignature = toSolanaSignature(signature);

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const statuses = await withSolanaLiveRetries(() =>
      rpc.getSignatureStatuses([submittedSignature], { searchTransactionHistory: true }).send(),
    );
    const status = statuses.value[0];

    if (status?.err) {
      throw new Error(
        `Solana signature ${signature} failed after submission: ${JSON.stringify(status.err)}`,
      );
    }

    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(`Solana signature ${signature} did not reach confirmed status in time`);
};

const verifySuccessfulSolanaLaunch = async (args: {
  configLabel: string;
  route: SolanaLiveRoute;
  payload: SolanaLivePayload;
  replayIdempotency?: boolean;
  expectedCurveFeeBps?: number;
  expectedAllowBuy?: boolean;
  expectedAllowSell?: boolean;
  expectedNumerairePriceUsd?: number;
  expectedBaseForDistribution?: string;
  expectedBaseForLiquidity?: string;
  expectedHookProgram?: string;
  expectedHookFlags?: number;
  expectedMigratorProgram?: string;
}) => {
  const summary: {
    config: string;
    status: 'created' | 'failed';
    salePercent: string;
    allocationAmount: string;
    allocationRecipients: string;
    vestMode: string;
    vestDuration: string;
    txHash?: string;
    pureUrl?: string;
    reason?: string;
  } = {
    config: args.configLabel,
    status: 'failed',
    salePercent: '100%',
    allocationAmount: '0',
    allocationRecipients: '0',
    vestMode: 'none',
    vestDuration: '0',
  };
  let submittedSignature: string | undefined;
  let explorerUrl: string | undefined;

  const { config, app } = await createLiveApp();
  const routePath = args.route === 'dedicated' ? '/v1/solana/launches' : '/v1/launches';
  const idempotencyKey = args.replayIdempotency
    ? `solana-live-replay-${Date.now()}-${randomBytes(4).toString('hex')}`
    : undefined;

  try {
    let firstResponse: Awaited<ReturnType<typeof app.inject>> | undefined;
    let transientReason: string | null = null;
    for (let attempt = 1; attempt <= SOLANA_LIVE_CREATE_ATTEMPTS; attempt += 1) {
      firstResponse = await app.inject({
        method: 'POST',
        url: routePath,
        headers: {
          'x-api-key': config.apiKey,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        payload: args.payload,
      });

      transientReason = parseTransientSolanaCreateFailure(firstResponse);
      if (!transientReason || attempt === SOLANA_LIVE_CREATE_ATTEMPTS) {
        break;
      }

      if (liveVerbose) {
        // eslint-disable-next-line no-console
        console.log(
          `Retrying Solana live create for ${args.configLabel} after transient ${firstResponse.statusCode}: ${transientReason}`,
        );
      }
      await sleep(SOLANA_LIVE_CREATE_RETRY_DELAY_MS);
    }

    if (!firstResponse) {
      throw new Error('Solana live create did not run');
    }

    if (firstResponse.statusCode !== 200) {
      throw new Error(
        `Unexpected Solana live response (${firstResponse.statusCode}): ${firstResponse.body}`,
      );
    }

    const body = firstResponse.json() as CreateSolanaLaunchResponse;
    submittedSignature = body.signature;
    explorerUrl = body.explorerUrl;
    const expectedBaseForDistribution = args.expectedBaseForDistribution ?? '0';
    const expectedBaseForLiquidity = args.expectedBaseForLiquidity ?? '0';
    const expectedTokensForSale = (
      BigInt(args.payload.economics.totalSupply) -
      BigInt(expectedBaseForDistribution) -
      BigInt(expectedBaseForLiquidity)
    ).toString();

    expect(body.network).toBe('solanaDevnet');
    expect(body.launchId).not.toContain(':');
    expect(body.signature).toBeTruthy();
    expect(body.explorerUrl).toContain(body.signature);
    expect(body.statusUrl).toBe(`/v1/solana/launches/${body.launchId}`);
    expect(body.effectiveConfig.tokensForSale).toBe(expectedTokensForSale);
    expect(body.effectiveConfig.allocationAmount).toBe(expectedBaseForDistribution);
    expect(body.effectiveConfig.baseForDistribution).toBe(expectedBaseForDistribution);
    expect(body.effectiveConfig.baseForLiquidity).toBe(expectedBaseForLiquidity);
    expect(body.effectiveConfig.allocationLockMode).toBe('none');
    expect(body.effectiveConfig.numeraireAddress).toBe(String(SOLANA_CONSTANTS.wsolMintAddress));
    expect(body.effectiveConfig.tokenDecimals).toBe(SOLANA_CONSTANTS.tokenDecimals);
    expect(body.effectiveConfig.swapFeeBps).toBe(body.effectiveConfig.curveFeeBps);
    if (args.expectedCurveFeeBps !== undefined) {
      expect(body.effectiveConfig.curveFeeBps).toBe(args.expectedCurveFeeBps);
    } else {
      expect(body.effectiveConfig.curveFeeBps).toBeGreaterThanOrEqual(0);
    }
    expect(body.effectiveConfig.allowBuy).toBe(args.expectedAllowBuy ?? true);
    expect(body.effectiveConfig.allowSell).toBe(args.expectedAllowSell ?? true);
    if (args.expectedNumerairePriceUsd !== undefined) {
      expect(body.effectiveConfig.numerairePriceUsd).toBe(args.expectedNumerairePriceUsd);
    }

    if (args.payload.feeBeneficiaries?.length) {
      expect(body.effectiveConfig.feeBeneficiariesSource).toBe('request');
      expect(body.effectiveConfig.feeBeneficiaries).toEqual(args.payload.feeBeneficiaries);
    }

    const distinctAddresses = new Set([
      body.launchId,
      body.predicted.tokenAddress,
      body.predicted.launchAuthorityAddress,
      body.predicted.launchFeeStateAddress,
      body.predicted.baseVaultAddress,
      body.predicted.quoteVaultAddress,
    ]);
    expect(distinctAddresses.size).toBe(6);

    const rpc = createSolanaRpc(config.solana.devnetRpcUrl);
    try {
      await waitForConfirmedSignature(rpc, body.signature);
    } catch (error) {
      if (liveVerbose) {
        // eslint-disable-next-line no-console
        console.log(
          `Solana signature status lookup skipped for ${body.signature}: ${toShortError(error)}`,
        );
      }
    }

    await assertSolanaAccountExists(rpc, body.launchId);
    await assertSolanaAccountExists(rpc, body.predicted.tokenAddress);
    await assertSolanaAccountExists(rpc, body.predicted.launchFeeStateAddress);
    await assertSolanaAccountExists(rpc, body.predicted.baseVaultAddress);
    await assertSolanaAccountExists(rpc, body.predicted.quoteVaultAddress);

    const metadataAddress = await initializer.getTokenMetadataAddress(
      address(body.predicted.tokenAddress),
    );
    await assertSolanaAccountExists(rpc, metadataAddress);

    const [derivedLaunchAuthorityAddress] = await initializer.getLaunchAuthorityAddress(
      address(body.launchId),
    );
    expect(derivedLaunchAuthorityAddress).toBe(body.predicted.launchAuthorityAddress);

    if (
      args.expectedHookProgram !== undefined ||
      args.expectedHookFlags !== undefined ||
      args.expectedMigratorProgram !== undefined
    ) {
      const statusResponse = await app.inject({
        method: 'GET',
        url: body.statusUrl,
        headers: {
          'x-api-key': config.apiKey,
        },
      });

      expect(statusResponse.statusCode).toBe(200);
      const statusBody = statusResponse.json() as {
        hookProgram: string;
        hookFlags: number;
        migratorProgram: string;
      };
      if (args.expectedHookProgram !== undefined) {
        expect(statusBody.hookProgram).toBe(args.expectedHookProgram);
      }
      if (args.expectedHookFlags !== undefined) {
        expect(statusBody.hookFlags).toBe(args.expectedHookFlags);
      }
      if (args.expectedMigratorProgram !== undefined) {
        expect(statusBody.migratorProgram).toBe(args.expectedMigratorProgram);
      }
    }

    if (args.replayIdempotency) {
      const replayResponse = await app.inject({
        method: 'POST',
        url: routePath,
        headers: {
          'x-api-key': config.apiKey,
          'idempotency-key': idempotencyKey!,
        },
        payload: args.payload,
      });

      expect(replayResponse.statusCode).toBe(200);
      expect(replayResponse.headers['x-idempotency-replayed']).toBe('true');
      expect(replayResponse.json()).toEqual(body);
    }

    summary.status = 'created';
    summary.allocationAmount =
      expectedBaseForLiquidity === '0'
        ? expectedBaseForDistribution
        : `${expectedBaseForDistribution}/${expectedBaseForLiquidity}`;
    summary.allocationRecipients = expectedBaseForDistribution === '0' ? '0' : '1';
    summary.txHash = body.signature;
    summary.pureUrl = body.explorerUrl;
  } catch (error) {
    summary.reason = toShortError(error);
    if (liveVerbose) {
      // eslint-disable-next-line no-console
      console.log(liveDivider(`Solana Live Failure: ${args.configLabel}`));
      printLiveTable('Failure Context', [
        ['Configuration', args.configLabel],
        ['Route', routePath],
        ['Submitted Signature', submittedSignature ?? 'n/a'],
        ['Explorer URL', explorerUrl ?? 'n/a'],
        ['Error', summary.reason],
      ]);
    }
    throw error;
  } finally {
    launchSummaries.push(summary);
    await app.close();
  }
};

const verifyFailedSolanaLaunch = async (args: {
  route: SolanaLiveRoute;
  payload: SolanaLivePayload;
  expectedStatusCode: number;
  expectedCode: string;
}) => {
  const { config, app } = await createLiveApp();
  const routePath = args.route === 'dedicated' ? '/v1/solana/launches' : '/v1/launches';

  try {
    const response = await app.inject({
      method: 'POST',
      url: routePath,
      headers: {
        'x-api-key': config.apiKey,
      },
      payload: args.payload,
    });

    expect(response.statusCode).toBe(args.expectedStatusCode);
    expect(response.json().error.code).toBe(args.expectedCode);
  } finally {
    await app.close();
  }
};

export const registerSolanaLiveScenarios = () => {
  liveIt(
    'SOLANA DEVNET LOW Default Range',
    ['solana', 'solana-devnet', 'solana-defaults'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET LOW Default Range',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('low'),
          economics: {
            totalSupply: '1000000000',
          },
          pricing: {
            numerairePriceUsd: 150,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 100,
              marketCapEndUsd: 1000,
            },
          },
        },
        expectedNumerairePriceUsd: 150,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET MEDIUM Default Range',
    ['solana', 'solana-devnet', 'solana-defaults'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET MEDIUM Default Range',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('medium'),
          economics: {
            totalSupply: '2500000000',
          },
          pricing: {
            numerairePriceUsd: 160,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 250,
              marketCapEndUsd: 5000,
            },
          },
        },
        expectedNumerairePriceUsd: 160,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET HIGH Default Range',
    ['solana', 'solana-devnet', 'solana-defaults'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET HIGH Default Range',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('high'),
          economics: {
            totalSupply: '5000000000',
          },
          pricing: {
            numerairePriceUsd: 180,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 1000,
              marketCapEndUsd: 25000,
            },
          },
        },
        expectedNumerairePriceUsd: 180,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Custom Fee + Beneficiary',
    ['solana', 'solana-devnet', 'solana-fees'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET Custom Fee + Beneficiary',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('fees'),
          economics: {
            totalSupply: '3000000000',
          },
          pricing: {
            numerairePriceUsd: 165,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 300,
              marketCapEndUsd: 7500,
            },
            swapFeeBps: 75,
          },
        },
        expectedCurveFeeBps: 75,
        expectedNumerairePriceUsd: 165,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET CPMM Migration Reserve Split',
    ['solana', 'solana-devnet', 'solana-cpmm'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET CPMM Migration Reserve Split',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('cpmm'),
          economics: {
            totalSupply: '6000000000',
            baseForDistribution: '200000000',
            baseForLiquidity: '300000000',
          },
          pricing: {
            numerairePriceUsd: 170,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
            supportCpmm: true,
            minimumQuoteRaise: '1000',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 500,
              marketCapEndUsd: 10000,
            },
            swapFeeBps: 100,
          },
        },
        expectedCurveFeeBps: 100,
        expectedNumerairePriceUsd: 170,
        expectedBaseForDistribution: '200000000',
        expectedBaseForLiquidity: '300000000',
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Random CPMM Reserve Split',
    ['solana', 'solana-devnet', 'solana-cpmm'],
    async () => {
      const totalSupply = 8_000_000_000n + BigInt(Math.floor(Math.random() * 4_000_000_000));
      const baseForDistribution = 100_000_000n + BigInt(Math.floor(Math.random() * 250_000_000));
      const baseForLiquidity = 150_000_000n + BigInt(Math.floor(Math.random() * 350_000_000));
      const marketCapStartUsd = 400 + Math.floor(Math.random() * 600);
      const marketCapEndUsd = marketCapStartUsd * (8 + Math.floor(Math.random() * 8));
      const curveFeeBps = 50 + Math.floor(Math.random() * 451);
      const numerairePriceUsd = 140 + Math.floor(Math.random() * 81);

      await verifySuccessfulSolanaLaunch({
        configLabel: `SOLANA DEVNET Random CPMM Reserve Split (${baseForDistribution}/${baseForLiquidity}, fee ${curveFeeBps} bps)`,
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('rcpmm'),
          economics: {
            totalSupply: totalSupply.toString(),
            baseForDistribution: baseForDistribution.toString(),
            baseForLiquidity: baseForLiquidity.toString(),
          },
          pricing: {
            numerairePriceUsd,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
            supportCpmm: true,
            minimumQuoteRaise: '1000',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd,
              marketCapEndUsd,
            },
            swapFeeBps: curveFeeBps,
          },
        },
        expectedCurveFeeBps: curveFeeBps,
        expectedNumerairePriceUsd: numerairePriceUsd,
        expectedBaseForDistribution: baseForDistribution.toString(),
        expectedBaseForLiquidity: baseForLiquidity.toString(),
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Generic Route + Idempotency Replay',
    ['solana', 'solana-devnet'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET Generic Route + Replay',
        route: 'generic',
        replayIdempotency: true,
        payload: {
          network: 'solanaDevnet',
          tokenMetadata: nextTokenMetadata('generic'),
          economics: {
            totalSupply: '2500000000',
          },
          pricing: {
            numerairePriceUsd: 160,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 120,
              marketCapEndUsd: 2400,
            },
          },
        },
        expectedNumerairePriceUsd: 160,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Buy-Only WSOL Pair',
    ['solana', 'solana-devnet'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET Buy-Only WSOL Pair',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('buyonly'),
          economics: {
            totalSupply: '12345678901',
          },
          pairing: {
            numeraireAddress: String(SOLANA_CONSTANTS.wsolMintAddress),
          },
          pricing: {
            numerairePriceUsd: 175,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 250,
              marketCapEndUsd: 12500,
            },
            allowBuy: true,
            allowSell: false,
          },
        },
        expectedAllowBuy: true,
        expectedAllowSell: false,
        expectedNumerairePriceUsd: 175,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET No Migration Criteria Dedicated',
    ['solana', 'solana-devnet', 'solana-no-migration'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET No Migration Criteria Dedicated',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('nomig'),
          economics: {
            totalSupply: '2200000000',
          },
          pricing: {
            numerairePriceUsd: 145,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 180,
              marketCapEndUsd: 3600,
            },
            allowBuy: true,
            allowSell: true,
          },
        },
        expectedNumerairePriceUsd: 145,
        expectedBaseForDistribution: '0',
        expectedBaseForLiquidity: '0',
        expectedHookProgram: String(SOLANA_CONSTANTS.systemProgramAddress),
        expectedHookFlags: 0,
        expectedMigratorProgram: String(SOLANA_CONSTANTS.systemProgramAddress),
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET No Migration Criteria Generic',
    ['solana', 'solana-devnet', 'solana-no-migration'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET No Migration Criteria Generic',
        route: 'generic',
        payload: {
          network: 'solanaDevnet',
          tokenMetadata: nextTokenMetadata('gnomig'),
          economics: {
            totalSupply: '4200000000',
          },
          pricing: {
            numerairePriceUsd: 190,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 320,
              marketCapEndUsd: 9600,
            },
            swapFeeBps: 90,
          },
        },
        expectedCurveFeeBps: 90,
        expectedNumerairePriceUsd: 190,
        expectedBaseForDistribution: '0',
        expectedBaseForLiquidity: '0',
        expectedHookProgram: String(SOLANA_CONSTANTS.systemProgramAddress),
        expectedHookFlags: 0,
        expectedMigratorProgram: String(SOLANA_CONSTANTS.systemProgramAddress),
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Random No Migration Criteria',
    ['solana', 'solana-devnet', 'solana-no-migration'],
    async () => {
      const totalSupply = (
        2_500_000_000n + BigInt(Math.floor(Math.random() * 7_500_000_000))
      ).toString();
      const marketCapStartUsd = 150 + Math.floor(Math.random() * 350);
      const marketCapEndUsd = marketCapStartUsd * (6 + Math.floor(Math.random() * 8));
      const curveFeeBps = 50 + Math.floor(Math.random() * 251);
      const numerairePriceUsd = 125 + Math.floor(Math.random() * 90);

      await verifySuccessfulSolanaLaunch({
        configLabel: `SOLANA DEVNET Random No Migration Criteria (${marketCapStartUsd}-${marketCapEndUsd}, fee ${curveFeeBps} bps)`,
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('rnomig'),
          economics: {
            totalSupply,
          },
          pricing: {
            numerairePriceUsd,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd,
              marketCapEndUsd,
            },
            swapFeeBps: curveFeeBps,
          },
        },
        expectedCurveFeeBps: curveFeeBps,
        expectedNumerairePriceUsd: numerairePriceUsd,
        expectedBaseForDistribution: '0',
        expectedBaseForLiquidity: '0',
        expectedHookProgram: String(SOLANA_CONSTANTS.systemProgramAddress),
        expectedHookFlags: 0,
        expectedMigratorProgram: String(SOLANA_CONSTANTS.systemProgramAddress),
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA Dedicated Route Rejects Reserve Split',
    ['solana', 'solana-devnet', 'solana-failing'],
    async () => {
      await verifyFailedSolanaLaunch({
        route: 'dedicated',
        expectedStatusCode: 422,
        expectedCode: 'SOLANA_INVALID_ECONOMICS',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('reserve'),
          economics: {
            totalSupply: '1000000000',
            baseForDistribution: '100000000',
            baseForLiquidity: '150000000',
          },
          pricing: {
            numerairePriceUsd: 150,
          },
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 100,
              marketCapEndUsd: 1000,
            },
          },
        },
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Random Parameters',
    ['solana', 'solana-devnet', 'solana-random'],
    async () => {
      const totalSupply = (
        2_000_000_000n + BigInt(Math.floor(Math.random() * 18_000_000_000))
      ).toString();
      const marketCapStartUsd = 75 + Math.floor(Math.random() * 425);
      const marketCapEndUsd = marketCapStartUsd * (4 + Math.floor(Math.random() * 9));
      const curveFeeBps = 50 + Math.floor(Math.random() * 951);
      let allowBuy = Math.random() >= 0.35;
      let allowSell = Math.random() >= 0.35;
      if (!allowBuy && !allowSell) {
        allowBuy = true;
      }
      const numerairePriceUsd = 100 + Math.floor(Math.random() * 151);

      await verifySuccessfulSolanaLaunch({
        configLabel: `SOLANA DEVNET Random Parameters (${marketCapStartUsd}-${marketCapEndUsd}, fee ${curveFeeBps} bps, buy=${allowBuy}, sell=${allowSell})`,
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('random'),
          economics: {
            totalSupply,
          },
          pricing: {
            numerairePriceUsd,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd,
              marketCapEndUsd,
            },
            swapFeeBps: curveFeeBps,
            allowBuy,
            allowSell,
          },
        },
        expectedCurveFeeBps: curveFeeBps,
        expectedAllowBuy: allowBuy,
        expectedAllowSell: allowSell,
        expectedNumerairePriceUsd: numerairePriceUsd,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Random Generic Route Parameters',
    ['solana', 'solana-devnet', 'solana-random'],
    async () => {
      const totalSupply = (
        1_500_000_000n + BigInt(Math.floor(Math.random() * 10_000_000_000))
      ).toString();
      const marketCapStartUsd = 90 + Math.floor(Math.random() * 360);
      const marketCapEndUsd = marketCapStartUsd * (5 + Math.floor(Math.random() * 7));
      const curveFeeBps = 60 + Math.floor(Math.random() * 441);
      const numerairePriceUsd = 120 + Math.floor(Math.random() * 101);

      await verifySuccessfulSolanaLaunch({
        configLabel: `SOLANA DEVNET Random Generic (${marketCapStartUsd}-${marketCapEndUsd}, fee ${curveFeeBps} bps)`,
        route: 'generic',
        payload: {
          network: 'solanaDevnet',
          tokenMetadata: nextTokenMetadata('rgen'),
          economics: {
            totalSupply,
          },
          pricing: {
            numerairePriceUsd,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd,
              marketCapEndUsd,
            },
            curveFeeBps,
          },
        },
        expectedCurveFeeBps: curveFeeBps,
        expectedNumerairePriceUsd: numerairePriceUsd,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Random Sell-Only Parameters',
    ['solana', 'solana-devnet', 'solana-random'],
    async () => {
      const marketCapStartUsd = 125 + Math.floor(Math.random() * 500);
      const marketCapEndUsd = marketCapStartUsd * (6 + Math.floor(Math.random() * 10));
      const curveFeeBps = 100 + Math.floor(Math.random() * 401);
      const numerairePriceUsd = 130 + Math.floor(Math.random() * 91);

      await verifySuccessfulSolanaLaunch({
        configLabel: `SOLANA DEVNET Random Sell-Only (${marketCapStartUsd}-${marketCapEndUsd}, fee ${curveFeeBps} bps)`,
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('rsell'),
          economics: {
            totalSupply: (
              4_000_000_000n + BigInt(Math.floor(Math.random() * 9_000_000_000))
            ).toString(),
          },
          pricing: {
            numerairePriceUsd,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd,
              marketCapEndUsd,
            },
            swapFeeBps: curveFeeBps,
            allowBuy: false,
            allowSell: true,
          },
        },
        expectedCurveFeeBps: curveFeeBps,
        expectedAllowBuy: false,
        expectedAllowSell: true,
        expectedNumerairePriceUsd: numerairePriceUsd,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Cosigning Hook Slot Expiry',
    ['solana', 'solana-devnet', 'solana-cosigner'],
    async () => {
      const cosigner = await generateKeyPairSigner();
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET Cosigning Hook Slot Expiry',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('coslot'),
          economics: {
            totalSupply: '3500000000',
          },
          pricing: {
            numerairePriceUsd: 155,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 300,
              marketCapEndUsd: 6000,
            },
            swapFeeBps: 125,
            cosigningHook: {
              type: 'cosigner',
              cosigner: cosigner.address,
              expiry: {
                mode: 'slot',
                value: '999999999999',
              },
            },
          },
        },
        expectedCurveFeeBps: 125,
        expectedNumerairePriceUsd: 155,
        expectedHookProgram: String(SOLANA_CONSTANTS.cosignerHookProgramId),
        expectedHookFlags: initializer.HF_BEFORE_SWAP | initializer.HF_FORWARD_READONLY_SIGNERS,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Cosigning Hook Timestamp Expiry',
    ['solana', 'solana-devnet', 'solana-cosigner'],
    async () => {
      const cosigner = await generateKeyPairSigner();
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET Cosigning Hook Timestamp Expiry',
        route: 'generic',
        payload: {
          network: 'solanaDevnet',
          tokenMetadata: nextTokenMetadata('cots'),
          economics: {
            totalSupply: '4500000000',
          },
          pricing: {
            numerairePriceUsd: 185,
          },
          feeBeneficiaries: await nextFeeBeneficiaries(),
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 450,
              marketCapEndUsd: 9000,
            },
            swapFeeBps: 150,
            cosigningHook: {
              type: 'cosigner',
              cosigner: cosigner.address,
              expiry: {
                mode: 'unixTimestamp',
                value: (Math.floor(Date.now() / 1000) + 86_400).toString(),
              },
            },
          },
        },
        expectedCurveFeeBps: 150,
        expectedNumerairePriceUsd: 185,
        expectedHookProgram: String(SOLANA_CONSTANTS.cosignerHookProgramId),
        expectedHookFlags: initializer.HF_BEFORE_SWAP | initializer.HF_FORWARD_READONLY_SIGNERS,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA Generic Route Rejects Short Alias',
    ['solana', 'solana-devnet', 'solana-failing'],
    async () => {
      await verifyFailedSolanaLaunch({
        route: 'generic',
        expectedStatusCode: 422,
        expectedCode: 'INVALID_REQUEST',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('badalias'),
          economics: {
            totalSupply: '1000000000',
          },
          pricing: {
            numerairePriceUsd: 150,
          },
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 100,
              marketCapEndUsd: 1000,
            },
          },
        } as unknown as SolanaLivePayload,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );
  liveIt(
    'SOLANA Dedicated Route Rejects Mainnet Beta Execution',
    ['solana', 'solana-devnet', 'solana-failing'],
    async () => {
      await verifyFailedSolanaLaunch({
        route: 'dedicated',
        expectedStatusCode: 501,
        expectedCode: 'SOLANA_NETWORK_UNSUPPORTED',
        payload: {
          network: 'mainnet-beta',
          tokenMetadata: nextTokenMetadata('mainnet'),
          economics: {
            totalSupply: '1000000000',
          },
          pricing: {
            numerairePriceUsd: 150,
          },
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 100,
              marketCapEndUsd: 1000,
            },
          },
        },
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA Dedicated Route Rejects Non-WSOL Numeraire',
    ['solana', 'solana-devnet', 'solana-failing'],
    async () => {
      await verifyFailedSolanaLaunch({
        route: 'dedicated',
        expectedStatusCode: 422,
        expectedCode: 'SOLANA_NUMERAIRE_UNSUPPORTED',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('badquote'),
          economics: {
            totalSupply: '1000000000',
          },
          pairing: {
            numeraireAddress: SOLANA_NON_WSOL_ADDRESS,
          },
          pricing: {
            numerairePriceUsd: 150,
          },
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 100,
              marketCapEndUsd: 1000,
            },
          },
        },
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA Dedicated Route Rejects Invalid Curve Range',
    ['solana', 'solana-devnet', 'solana-failing'],
    async () => {
      await verifyFailedSolanaLaunch({
        route: 'dedicated',
        expectedStatusCode: 422,
        expectedCode: 'SOLANA_INVALID_CURVE',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('badcurve'),
          economics: {
            totalSupply: '1000000000',
          },
          pricing: {
            numerairePriceUsd: 150,
          },
          governance: false,
          migration: {
            type: 'none',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 1000,
              marketCapEndUsd: 100,
            },
          },
        },
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );
};
