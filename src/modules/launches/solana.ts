import { createHash, randomBytes } from 'node:crypto';

import {
  type Address,
  address,
  appendTransactionMessageInstructions,
  assertAccountExists,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  decodeAccount,
  fetchAddressesForLookupTables,
  fetchEncodedAccount,
  generateKeyPairSigner,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signature,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import { cpmm, initializer } from '@whetstone-research/doppler-sdk/solana';
import { z } from 'zod';

import type { AppConfig } from '../../core/config';
import { AppError } from '../../core/errors';
import type {
  CreateSolanaLaunchResponse,
  SolanaNetwork,
} from '../../core/types';
import type { PricingService } from '../pricing/service';

const U64_MAX = 18_446_744_073_709_551_615n;
const SOLANA_TOKEN_DECIMALS = 9;
const SOLANA_NUMERAIRE_DECIMALS = 9;
const SOLANA_CONFIRM_POLL_INTERVAL_MS = 500;
const SOLANA_WSOL_MINT_ADDRESS = address('So11111111111111111111111111111111111111112');
const SOLANA_SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');
const SOLANA_RENT_SYSVAR_ADDRESS = address('SysvarRent111111111111111111111111111111111');

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const positiveFiniteNumberSchema = z
  .number()
  .refine((value) => Number.isFinite(value) && value > 0, 'must be a positive number');

const solanaAddressSchema = z
  .string()
  .refine((value) => {
    try {
      address(value);
      return true;
    } catch {
      return false;
    }
  }, 'must be a valid Solana address');

const u64StringSchema = z
  .string()
  .regex(/^\d+$/, 'must be a positive integer string')
  .refine((value) => {
    const parsed = BigInt(value);
    return parsed > 0n && parsed <= U64_MAX;
  }, 'must be a positive u64 integer string');

const canonicalSolanaNetworkSchema = z.enum(['solanaDevnet', 'solanaMainnetBeta']);
const dedicatedSolanaNetworkSchema = z.enum(['devnet', 'mainnet-beta']);

const solanaTokenMetadataSchema = strictObject({
  name: z.string().min(1).max(32),
  symbol: z.string().min(1).max(10),
  tokenURI: z.string().min(1).max(200),
});

const solanaEconomicsSchema = strictObject({
  totalSupply: u64StringSchema,
});

const solanaPairingSchema = strictObject({
  numeraireAddress: solanaAddressSchema.optional(),
});

const solanaPricingSchema = strictObject({
  numerairePriceUsd: positiveFiniteNumberSchema.optional(),
});

const solanaMigrationSchema = strictObject({
  type: z.literal('noOp'),
});

const solanaAuctionSchema = strictObject({
  type: z.literal('xyk'),
  curveConfig: strictObject({
    type: z.literal('range'),
    marketCapStartUsd: positiveFiniteNumberSchema,
    marketCapEndUsd: positiveFiniteNumberSchema,
  }),
  curveFeeBps: z.number().int().min(0).max(10_000).optional(),
  allowBuy: z.boolean().optional(),
  allowSell: z.boolean().optional(),
});

const baseSolanaCreateLaunchRequestShape = {
  tokenMetadata: solanaTokenMetadataSchema,
  economics: solanaEconomicsSchema,
  pairing: solanaPairingSchema.optional(),
  pricing: solanaPricingSchema.optional(),
  governance: z.literal(false).optional(),
  migration: solanaMigrationSchema.optional(),
  auction: solanaAuctionSchema,
} satisfies z.ZodRawShape;

export const dedicatedSolanaCreateLaunchRequestSchema = strictObject({
  network: dedicatedSolanaNetworkSchema.optional(),
  ...baseSolanaCreateLaunchRequestShape,
});

export const genericSolanaCreateLaunchRequestSchema = strictObject({
  network: canonicalSolanaNetworkSchema,
  ...baseSolanaCreateLaunchRequestShape,
});

export type DedicatedSolanaCreateLaunchRequestInput = z.infer<
  typeof dedicatedSolanaCreateLaunchRequestSchema
>;
export type CreateSolanaLaunchRequestInput = z.infer<typeof genericSolanaCreateLaunchRequestSchema>;

export interface SolanaReadinessCheck {
  name: 'rpcReachable' | 'latestBlockhash' | 'initializerConfig' | 'addressLookupTable';
  ok: boolean;
  error?: string;
}

export interface SolanaReadinessResult {
  enabled: boolean;
  ok: boolean;
  network?: 'solanaDevnet';
  checks: SolanaReadinessCheck[];
}

interface DerivedCurveConfig {
  curveVirtualBase: bigint;
  curveVirtualQuote: bigint;
}

const toCanonicalSolanaNetwork = (
  network: z.infer<typeof dedicatedSolanaNetworkSchema>,
): SolanaNetwork => {
  if (network === 'devnet') {
    return 'solanaDevnet';
  }

  return 'solanaMainnetBeta';
};

export const isSolanaCanonicalNetwork = (value: unknown): value is SolanaNetwork =>
  value === 'solanaDevnet' || value === 'solanaMainnetBeta';

export const normalizeDedicatedSolanaCreateRequest = (
  input: DedicatedSolanaCreateLaunchRequestInput,
  defaultNetwork: SolanaNetwork,
): CreateSolanaLaunchRequestInput =>
  genericSolanaCreateLaunchRequestSchema.parse({
    ...input,
    network: input.network ? toCanonicalSolanaNetwork(input.network) : defaultNetwork,
  });

const remapSolanaSchemaError = (error: z.ZodError): never => {
  const metadataIssue = error.issues.find((issue) => issue.path[0] === 'tokenMetadata');
  if (metadataIssue) {
    throw new AppError(422, 'SOLANA_INVALID_METADATA', 'Invalid Solana token metadata', {
      issues: error.issues,
    });
  }

  const curveIssue = error.issues.find(
    (issue) =>
      issue.path[0] === 'auction' &&
      (issue.path[1] === 'type' ||
        issue.path[1] === 'curveConfig' ||
        issue.path[1] === 'curveFeeBps'),
  );
  if (curveIssue) {
    throw new AppError(422, 'SOLANA_INVALID_CURVE', 'Invalid Solana XYK curve configuration', {
      issues: error.issues,
    });
  }

  throw error;
};

export const parseDedicatedSolanaCreateLaunchRequest = (
  body: unknown,
  defaultNetwork: SolanaNetwork,
): CreateSolanaLaunchRequestInput => {
  try {
    const parsed = dedicatedSolanaCreateLaunchRequestSchema.parse(body);
    return normalizeDedicatedSolanaCreateRequest(parsed, defaultNetwork);
  } catch (error) {
    if (error instanceof z.ZodError) {
      remapSolanaSchemaError(error);
    }

    throw error;
  }
};

export const parseGenericSolanaCreateLaunchRequest = (
  body: unknown,
): CreateSolanaLaunchRequestInput => {
  try {
    return genericSolanaCreateLaunchRequestSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      remapSolanaSchemaError(error);
    }

    throw error;
  }
};

export const deriveSolanaLaunchSeed = (
  network: SolanaNetwork,
  idempotencyKey?: string,
): Uint8Array => {
  if (!idempotencyKey) {
    return randomBytes(32);
  }

  return createHash('sha256')
    .update(`solana-launch:${network}:${idempotencyKey}`)
    .digest();
};

const buildExplorerUrl = (network: SolanaNetwork, signature: string): string => {
  if (network === 'solanaDevnet') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }

  return `https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'dependency unavailable';
};

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const relativeError = (actual: number, expected: number): number =>
  expected === 0 ? 0 : Math.abs(actual - expected) / expected;

const resolveVirtualBaseForRange = (
  baseForCurve: bigint,
  marketCapStartUsd: number,
  marketCapEndUsd: number,
): bigint => {
  const priceRatio = marketCapEndUsd / marketCapStartUsd;
  const sqrtRatio = Math.sqrt(priceRatio);
  if (!Number.isFinite(sqrtRatio) || sqrtRatio <= 1) {
    throw new AppError(
      422,
      'SOLANA_INVALID_CURVE',
      'marketCapEndUsd must be greater than marketCapStartUsd',
    );
  }

  const virtualBase = Math.floor(Number(baseForCurve) / (sqrtRatio - 1));
  if (!Number.isFinite(virtualBase) || virtualBase <= 0) {
    throw new AppError(
      422,
      'SOLANA_INVALID_CURVE',
      'Unable to derive a valid Solana XYK curve from the requested market-cap range',
    );
  }

  const asBigInt = BigInt(virtualBase);
  if (asBigInt <= 0n || asBigInt > U64_MAX) {
    throw new AppError(
      422,
      'SOLANA_INVALID_CURVE',
      'Derived Solana XYK reserves exceed the supported u64 range',
    );
  }

  return asBigInt;
};

export const deriveSolanaCurveConfig = (args: {
  totalSupply: bigint;
  numerairePriceUsd: number;
  marketCapStartUsd: number;
  marketCapEndUsd: number;
}): DerivedCurveConfig => {
  const baseForCurve = args.totalSupply;
  const virtualBase = resolveVirtualBaseForRange(
    baseForCurve,
    args.marketCapStartUsd,
    args.marketCapEndUsd,
  );
  const { start } = cpmm.marketCapToCurveParams({
    startMarketCapUSD: args.marketCapStartUsd,
    endMarketCapUSD: args.marketCapEndUsd,
    baseTotalSupply: args.totalSupply,
    baseForCurve,
    baseDecimals: SOLANA_TOKEN_DECIMALS,
    quoteDecimals: SOLANA_NUMERAIRE_DECIMALS,
    numerairePriceUSD: args.numerairePriceUsd,
    virtualBase,
  });

  if (
    start.curveVirtualBase <= 0n ||
    start.curveVirtualQuote <= 0n ||
    start.curveVirtualBase > U64_MAX ||
    start.curveVirtualQuote > U64_MAX
  ) {
    throw new AppError(
      422,
      'SOLANA_INVALID_CURVE',
      'Derived Solana XYK virtual reserves are out of bounds',
    );
  }

  const baseReserveStart = baseForCurve;
  const quoteReserveStart = 0n;
  const quoteReserveEnd = (baseForCurve * start.curveVirtualQuote) / start.curveVirtualBase;
  const derivedStartMarketCap = cpmm.curveParamsToMarketCap({
    curveVirtualBase: start.curveVirtualBase,
    curveVirtualQuote: start.curveVirtualQuote,
    baseReserve: baseReserveStart,
    quoteReserve: quoteReserveStart,
    baseTotalSupply: args.totalSupply,
    baseDecimals: SOLANA_TOKEN_DECIMALS,
    quoteDecimals: SOLANA_NUMERAIRE_DECIMALS,
    numerairePriceUSD: args.numerairePriceUsd,
  });
  const derivedEndMarketCap = cpmm.curveParamsToMarketCap({
    curveVirtualBase: start.curveVirtualBase,
    curveVirtualQuote: start.curveVirtualQuote,
    baseReserve: 0n,
    quoteReserve: quoteReserveEnd,
    baseTotalSupply: args.totalSupply,
    baseDecimals: SOLANA_TOKEN_DECIMALS,
    quoteDecimals: SOLANA_NUMERAIRE_DECIMALS,
    numerairePriceUSD: args.numerairePriceUsd,
  });

  if (
    relativeError(derivedStartMarketCap, args.marketCapStartUsd) > 0.02 ||
    relativeError(derivedEndMarketCap, args.marketCapEndUsd) > 0.02
  ) {
    throw new AppError(
      422,
      'SOLANA_INVALID_CURVE',
      'Unable to derive a stable Solana XYK curve for the requested market-cap range',
    );
  }

  return {
    curveVirtualBase: start.curveVirtualBase,
    curveVirtualQuote: start.curveVirtualQuote,
  };
};

export class SolanaLaunchService {
  private readonly config: AppConfig;
  private readonly pricingService: PricingService;
  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private payerSignerPromise?: Promise<Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>>;

  constructor(args: { config: AppConfig; pricingService: PricingService }) {
    this.config = args.config;
    this.pricingService = args.pricingService;
    this.rpc = createSolanaRpc(this.config.solana.devnetRpcUrl);
  }

  private getAltAddress(): Address | undefined {
    if (!this.config.solana.useAlt) {
      return undefined;
    }

    return this.config.solana.altAddress
      ? address(this.config.solana.altAddress)
      : initializer.DOPPLER_DEVNET_ALT;
  }

  private async getPayerSigner() {
    if (!this.config.solana.keypairBytes) {
      throw new AppError(500, 'MISSING_ENV', 'SOLANA_KEYPAIR is required for Solana creation');
    }

    if (!this.payerSignerPromise) {
      this.payerSignerPromise = createKeyPairSignerFromBytes(this.config.solana.keypairBytes);
    }

    return this.payerSignerPromise;
  }

  private assertEnabled(): void {
    if (!this.config.solana.enabled) {
      throw new AppError(
        501,
        'SOLANA_NETWORK_UNSUPPORTED',
        'Solana creation is not enabled on this server',
      );
    }
  }

  private assertSupportedNetwork(network: SolanaNetwork): void {
    if (network === 'solanaMainnetBeta') {
      throw new AppError(
        501,
        'SOLANA_NETWORK_UNSUPPORTED',
        'solanaMainnetBeta is scaffolded but not executable in this API profile',
      );
    }
  }

  private resolveNumeraireAddress(input: CreateSolanaLaunchRequestInput): Address {
    const requested = input.pairing?.numeraireAddress;
    if (!requested) {
      return SOLANA_WSOL_MINT_ADDRESS;
    }

    if (requested !== SOLANA_WSOL_MINT_ADDRESS) {
      throw new AppError(
        422,
        'SOLANA_NUMERAIRE_UNSUPPORTED',
        'Solana launches currently support only the WSOL numeraire mint',
      );
    }

    return address(requested);
  }

  private async resolveNumerairePriceUsd(
    input: CreateSolanaLaunchRequestInput,
    numeraireAddress: Address,
  ): Promise<number> {
    if (numeraireAddress !== SOLANA_WSOL_MINT_ADDRESS) {
      throw new AppError(
        422,
        'SOLANA_NUMERAIRE_UNSUPPORTED',
        'Solana launches currently support only the WSOL numeraire mint',
      );
    }

    const override = input.pricing?.numerairePriceUsd;
    if (override !== undefined) {
      if (!Number.isFinite(override) || override <= 0) {
        throw new AppError(
          422,
          'SOLANA_NUMERAIRE_PRICE_REQUIRED',
          'pricing.numerairePriceUsd must be a positive number',
        );
      }
      return override;
    }

    if (this.config.solana.fixedNumerairePriceUsd !== undefined) {
      return this.config.solana.fixedNumerairePriceUsd;
    }

    if (this.config.solana.priceMode === 'coingecko') {
      return this.pricingService.getUsdPriceByAssetId(this.config.solana.coingeckoAssetId);
    }

    throw new AppError(
      422,
      'SOLANA_NUMERAIRE_PRICE_REQUIRED',
      'WSOL/USD price resolution is unavailable; provide pricing.numerairePriceUsd in the request',
    );
  }

  private async fetchInitializerConfigAddress(): Promise<Address> {
    const [configAddress] = await initializer.getConfigAddress();
    const encodedAccount = await fetchEncodedAccount(this.rpc, configAddress, {
      commitment: 'confirmed',
    });
    const decodedAccount = decodeAccount(encodedAccount, initializer.getInitConfigDecoder());
    assertAccountExists(decodedAccount);
    return configAddress;
  }

  async getReadiness(): Promise<SolanaReadinessResult> {
    if (!this.config.solana.enabled) {
      return { enabled: false, ok: true, checks: [] };
    }

    const checks: SolanaReadinessCheck[] = [];

    try {
      await this.rpc.getVersion().send();
      checks.push({ name: 'rpcReachable', ok: true });
    } catch (error) {
      checks.push({ name: 'rpcReachable', ok: false, error: errorMessage(error) });
    }

    try {
      await this.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      checks.push({ name: 'latestBlockhash', ok: true });
    } catch (error) {
      checks.push({ name: 'latestBlockhash', ok: false, error: errorMessage(error) });
    }

    try {
      await this.fetchInitializerConfigAddress();
      checks.push({ name: 'initializerConfig', ok: true });
    } catch (error) {
      checks.push({ name: 'initializerConfig', ok: false, error: errorMessage(error) });
    }

    const altAddress = this.getAltAddress();
    if (altAddress) {
      try {
        await fetchAddressesForLookupTables([altAddress], this.rpc, {
          commitment: 'confirmed',
        });
        checks.push({ name: 'addressLookupTable', ok: true });
      } catch (error) {
        checks.push({ name: 'addressLookupTable', ok: false, error: errorMessage(error) });
      }
    } else {
      checks.push({ name: 'addressLookupTable', ok: true });
    }

    return {
      enabled: true,
      network: 'solanaDevnet',
      ok: checks.every((check) => check.ok),
      checks,
    };
  }

  async createLaunch(
    input: CreateSolanaLaunchRequestInput,
    idempotencyKey?: string,
  ): Promise<CreateSolanaLaunchResponse> {
    this.assertEnabled();
    this.assertSupportedNetwork(input.network);

    const readiness = await this.getReadiness();
    if (!readiness.ok) {
      throw new AppError(503, 'SOLANA_NOT_READY', 'Solana devnet is not ready for launch creation');
    }

    const totalSupply = BigInt(input.economics.totalSupply);
    const numeraireAddress = this.resolveNumeraireAddress(input);
    const numerairePriceUsd = await this.resolveNumerairePriceUsd(input, numeraireAddress);
    const curveFeeBps = input.auction.curveFeeBps ?? 0;
    const allowBuy = input.auction.allowBuy ?? true;
    const allowSell = input.auction.allowSell ?? true;
    const curveConfig = deriveSolanaCurveConfig({
      totalSupply,
      numerairePriceUsd,
      marketCapStartUsd: input.auction.curveConfig.marketCapStartUsd,
      marketCapEndUsd: input.auction.curveConfig.marketCapEndUsd,
    });

    const payer = await this.getPayerSigner();
    const launchSeed = deriveSolanaLaunchSeed(input.network, idempotencyKey);
    const namespace = payer.address;
    const [launchAddress] = await initializer.getLaunchAddress(namespace, launchSeed);
    const [launchAuthorityAddress] = await initializer.getLaunchAuthorityAddress(launchAddress);
    const configAddress = await this.fetchInitializerConfigAddress();
    const baseMint = await generateKeyPairSigner();
    const baseVault = await generateKeyPairSigner();
    const quoteVault = await generateKeyPairSigner();
    const metadataAddress = await initializer.getTokenMetadataAddress(baseMint.address);
    const altAddress = this.getAltAddress();

    const distinctAddresses = new Set([
      launchAddress,
      launchAuthorityAddress,
      configAddress,
      baseMint.address,
      baseVault.address,
      quoteVault.address,
      metadataAddress,
      numeraireAddress,
    ]);
    if (distinctAddresses.size !== 8) {
      throw new AppError(
        500,
        'SOLANA_SUBMISSION_FAILED',
        'Derived Solana launch addresses are internally inconsistent',
      );
    }

    const instruction = await initializer.createInitializeLaunchInstruction(
      {
        config: configAddress,
        launch: launchAddress,
        launchAuthority: launchAuthorityAddress,
        baseMint,
        quoteMint: numeraireAddress,
        baseVault,
        quoteVault,
        payer,
        authority: payer,
        // The initializer still expects a migrator program account even for no-op launches.
        migratorProgram: SOLANA_SYSTEM_PROGRAM_ADDRESS,
        rent: SOLANA_RENT_SYSVAR_ADDRESS,
        metadataAccount: metadataAddress,
        ...(altAddress ? { addressLookupTable: altAddress } : {}),
      },
      {
        namespace,
        launchId: launchSeed,
        baseDecimals: SOLANA_TOKEN_DECIMALS,
        baseTotalSupply: totalSupply,
        baseForDistribution: 0n,
        baseForLiquidity: 0n,
        curveVirtualBase: curveConfig.curveVirtualBase,
        curveVirtualQuote: curveConfig.curveVirtualQuote,
        curveFeeBps,
        curveKind: initializer.CURVE_KIND_XYK,
        curveParams: new Uint8Array([initializer.CURVE_PARAMS_FORMAT_XYK_V0]),
        allowBuy,
        allowSell,
        sentinelProgram: SOLANA_SYSTEM_PROGRAM_ADDRESS,
        sentinelFlags: 0,
        sentinelCalldata: new Uint8Array(),
        migratorInitCalldata: new Uint8Array(),
        migratorMigrateCalldata: new Uint8Array(),
        sentinelRemainingAccountsHash: initializer.EMPTY_REMAINING_ACCOUNTS_HASH,
        migratorRemainingAccountsHash: initializer.EMPTY_REMAINING_ACCOUNTS_HASH,
        metadataName: input.tokenMetadata.name,
        metadataSymbol: input.tokenMetadata.symbol,
        metadataUri: input.tokenMetadata.tokenURI,
      },
    );

    const latestBlockhash = await this.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const transactionMessage = appendTransactionMessageInstructions(
      [instruction],
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash.value,
        setTransactionMessageFeePayerSigner(payer, createTransactionMessage({ version: 0 })),
      ),
    );

    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    const feePayerSignature = signedTransaction.signatures[payer.address];
    if (!feePayerSignature) {
      throw new AppError(
        500,
        'SOLANA_SUBMISSION_FAILED',
        'Failed to sign Solana launch transaction with the configured payer',
      );
    }

    const transactionSignature = signature(getBase58Decoder().decode(feePayerSignature));
    const explorerUrl = buildExplorerUrl(input.network, transactionSignature);
    const wireTransaction = getBase64EncodedWireTransaction(signedTransaction);

    let simulation: { value: { err: unknown; logs: string[] | null } };
    try {
      simulation = await this.rpc
        .simulateTransaction(wireTransaction, {
          commitment: 'confirmed',
          encoding: 'base64',
          replaceRecentBlockhash: false,
          sigVerify: true,
        })
        .send();
    } catch (error) {
      throw new AppError(
        502,
        'SOLANA_SIMULATION_FAILED',
        'Failed to simulate Solana launch transaction',
        { cause: errorMessage(error) },
      );
    }

    const simulationLogs = simulation.value.logs ?? [];
    if (simulation.value.err) {
      const parsedError = cpmm.parseErrorFromLogs(simulationLogs);
      throw new AppError(
        422,
        'SOLANA_SIMULATION_FAILED',
        parsedError?.message ?? 'Solana launch simulation failed',
        parsedError
          ? {
              programError: {
                code: parsedError.code,
                codeName: parsedError.codeName,
                message: parsedError.message,
              },
              logs: simulationLogs,
            }
          : { logs: simulationLogs },
      );
    }

    try {
      await this.rpc
        .sendTransaction(wireTransaction, {
          encoding: 'base64',
          maxRetries: 0n,
          preflightCommitment: 'confirmed',
          skipPreflight: true,
        })
        .send();
    } catch (error) {
      throw new AppError(
        502,
        'SOLANA_SUBMISSION_FAILED',
        'Failed to submit Solana launch transaction',
        { cause: errorMessage(error) },
      );
    }

    const deadline = Date.now() + this.config.solana.confirmTimeoutMs;
    try {
      for (;;) {
        const statuses = await this.rpc.getSignatureStatuses([transactionSignature]).send();
        const status = statuses.value[0];
        if (status?.err) {
          throw new AppError(
            502,
            'SOLANA_SUBMISSION_FAILED',
            'Solana launch transaction was rejected after submission',
            { status: status.err },
          );
        }

        if (
          status?.confirmationStatus === 'confirmed' ||
          status?.confirmationStatus === 'finalized'
        ) {
          break;
        }

        if (Date.now() >= deadline) {
          throw new AppError(
            409,
            'SOLANA_LAUNCH_IN_DOUBT',
            'Solana launch submission completed but confirmation did not resolve before timeout',
            {
              launchId: launchAddress,
              signature: transactionSignature,
              explorerUrl,
            },
          );
        }

        await delay(SOLANA_CONFIRM_POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        409,
        'SOLANA_LAUNCH_IN_DOUBT',
        'Solana launch submission completed but confirmation could not be verified',
        {
          launchId: launchAddress,
          signature: transactionSignature,
          explorerUrl,
        },
      );
    }

    return {
      launchId: launchAddress,
      network: input.network,
      signature: transactionSignature,
      explorerUrl,
      predicted: {
        tokenAddress: baseMint.address,
        launchAuthorityAddress,
        baseVaultAddress: baseVault.address,
        quoteVaultAddress: quoteVault.address,
      },
      effectiveConfig: {
        tokensForSale: totalSupply.toString(),
        allocationAmount: '0',
        allocationLockMode: 'none',
        numeraireAddress,
        numerairePriceUsd,
        curveVirtualBase: curveConfig.curveVirtualBase.toString(),
        curveVirtualQuote: curveConfig.curveVirtualQuote.toString(),
        curveFeeBps,
        allowBuy,
        allowSell,
        tokenDecimals: SOLANA_TOKEN_DECIMALS,
      },
    };
  }
}

export const SOLANA_CONSTANTS = {
  tokenDecimals: SOLANA_TOKEN_DECIMALS,
  wsolMintAddress: SOLANA_WSOL_MINT_ADDRESS,
};
