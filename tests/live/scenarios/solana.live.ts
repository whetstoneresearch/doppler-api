import { randomBytes } from 'node:crypto';

import { expect } from 'vitest';
import {
  address,
  assertAccountExists,
  createSolanaRpc,
  fetchEncodedAccount,
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

type SolanaLiveRoute = 'dedicated' | 'generic';
type SolanaLivePayload =
  | DedicatedSolanaCreateLaunchRequestInput
  | CreateSolanaLaunchRequestInput;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const nextTokenMetadata = (prefix: string) => {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return {
    name: `SOL ${prefix} ${suffix}`.slice(0, 32),
    symbol: `${prefix.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4)}${suffix}`.slice(0, 10),
    tokenURI: `ipfs://live-solana/${prefix.toLowerCase()}/${Date.now()}-${suffix.toLowerCase()}`,
  };
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
  const account = await fetchEncodedAccount(rpc, address(accountAddress), SOLANA_ACCOUNT_COMMITMENT);
  assertAccountExists(account);
};

const waitForConfirmedSignature = async (
  rpc: ReturnType<typeof createSolanaRpc>,
  signature: string,
): Promise<void> => {
  const submittedSignature = toSolanaSignature(signature);

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const statuses = await rpc.getSignatureStatuses([submittedSignature]).send();
    const status = statuses.value[0];

    if (status?.err) {
      throw new Error(`Solana signature ${signature} failed after submission: ${JSON.stringify(status.err)}`);
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
    const firstResponse = await app.inject({
      method: 'POST',
      url: routePath,
      headers: {
        'x-api-key': config.apiKey,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      payload: args.payload,
    });

    if (firstResponse.statusCode !== 200) {
      throw new Error(`Unexpected Solana live response (${firstResponse.statusCode}): ${firstResponse.body}`);
    }

    const body = firstResponse.json() as CreateSolanaLaunchResponse;
    submittedSignature = body.signature;
    explorerUrl = body.explorerUrl;

    expect(body.network).toBe('solanaDevnet');
    expect(body.launchId).not.toContain(':');
    expect(body.signature).toBeTruthy();
    expect(body.explorerUrl).toContain(body.signature);
    expect(body.effectiveConfig.tokensForSale).toBe(args.payload.economics.totalSupply);
    expect(body.effectiveConfig.allocationAmount).toBe('0');
    expect(body.effectiveConfig.allocationLockMode).toBe('none');
    expect(body.effectiveConfig.numeraireAddress).toBe(String(SOLANA_CONSTANTS.wsolMintAddress));
    expect(body.effectiveConfig.tokenDecimals).toBe(SOLANA_CONSTANTS.tokenDecimals);
    expect(body.effectiveConfig.curveFeeBps).toBe(args.expectedCurveFeeBps ?? 0);
    expect(body.effectiveConfig.allowBuy).toBe(args.expectedAllowBuy ?? true);
    expect(body.effectiveConfig.allowSell).toBe(args.expectedAllowSell ?? true);
    if (args.expectedNumerairePriceUsd !== undefined) {
      expect(body.effectiveConfig.numerairePriceUsd).toBe(args.expectedNumerairePriceUsd);
    }

    const distinctAddresses = new Set([
      body.launchId,
      body.predicted.tokenAddress,
      body.predicted.launchAuthorityAddress,
      body.predicted.baseVaultAddress,
      body.predicted.quoteVaultAddress,
    ]);
    expect(distinctAddresses.size).toBe(5);

    const rpc = createSolanaRpc(config.solana.devnetRpcUrl);
    await waitForConfirmedSignature(rpc, body.signature);

    await assertSolanaAccountExists(rpc, body.launchId);
    await assertSolanaAccountExists(rpc, body.predicted.tokenAddress);
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
    'SOLANA DEVNET Basic Create',
    ['solana', 'solana-devnet', 'solana-defaults'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET Basic Create',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('basic'),
          economics: {
            totalSupply: '1000000000',
          },
          pricing: {
            numerairePriceUsd: 150,
          },
          governance: false,
          migration: {
            type: 'noOp',
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
    'SOLANA DEVNET Complicated Create (WSOL + Fee + Buy-Only)',
    ['solana', 'solana-devnet'],
    async () => {
      await verifySuccessfulSolanaLaunch({
        configLabel: 'SOLANA DEVNET Complicated Create',
        route: 'dedicated',
        payload: {
          network: 'devnet',
          tokenMetadata: nextTokenMetadata('complex'),
          economics: {
            totalSupply: '12345678901',
          },
          pairing: {
            numeraireAddress: String(SOLANA_CONSTANTS.wsolMintAddress),
          },
          pricing: {
            numerairePriceUsd: 175,
          },
          governance: false,
          migration: {
            type: 'noOp',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 250,
              marketCapEndUsd: 12500,
            },
            curveFeeBps: 37,
            allowBuy: true,
            allowSell: false,
          },
        },
        expectedCurveFeeBps: 37,
        expectedAllowBuy: true,
        expectedAllowSell: false,
        expectedNumerairePriceUsd: 175,
      });
    },
    SOLANA_LIVE_TIMEOUT_MS,
  );

  liveIt(
    'SOLANA DEVNET Generic Route + Idempotency Replay',
    ['solana', 'solana-devnet', 'solana-defaults'],
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
          governance: false,
          migration: {
            type: 'noOp',
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
    'SOLANA DEVNET Random Parameters',
    ['solana', 'solana-devnet', 'solana-random'],
    async () => {
      const totalSupply = (2_000_000_000n + BigInt(Math.floor(Math.random() * 18_000_000_000))).toString();
      const marketCapStartUsd = 75 + Math.floor(Math.random() * 425);
      const marketCapEndUsd = marketCapStartUsd * (4 + Math.floor(Math.random() * 9));
      const curveFeeBps = Math.floor(Math.random() * 101);
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
          governance: false,
          migration: {
            type: 'noOp',
          },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd,
              marketCapEndUsd,
            },
            curveFeeBps,
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
            type: 'noOp',
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
            type: 'noOp',
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
            type: 'noOp',
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
            type: 'noOp',
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
