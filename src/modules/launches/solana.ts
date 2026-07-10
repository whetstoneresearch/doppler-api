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
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import {
  cosignerHook,
  cpmm,
  cpmmMigrator,
  initializer,
} from '@whetstone-research/doppler-sdk/solana';

import type { AppConfig } from '../../core/config';
import { AppError } from '../../core/errors';
import type {
  CreateSolanaLaunchResponse,
  SolanaLaunchReadResponse,
  SolanaNetwork,
} from '../../core/types';
import type { PricingService } from '../pricing/service';
import {
  SOLANA_FEE_BPS_DENOMINATOR,
  SOLANA_MAX_FEE_BENEFICIARIES,
  type CreateSolanaLaunchRequestInput,
} from './solana-schema';
import {
  SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH,
  SOLANA_RENT_SYSVAR_ADDRESS,
  SOLANA_SYSTEM_PROGRAM_ADDRESS,
  SOLANA_TOKEN_DECIMALS,
  buildSolanaLaunchConfirmationLookupError,
  buildSolanaLaunchConfirmationTimeoutError,
  buildSolanaCpmmMigrationPayloads,
  buildSolanaLaunchHookConfig,
  buildSolanaLookupTableConfirmTimeoutError,
  buildSolanaLookupTableSubmitError,
  buildSolanaLookupTableWarmupTimeoutError,
  buildSolanaSimulationProgramError,
  buildSolanaSimulationRpcError,
  buildSolanaInitializeLaunchInstructionArgs,
  isSolanaSignatureConfirmed,
  throwIfSolanaSignatureRejected,
} from './solana-assembly';
import * as dynamicFeeHook from './solana-dynamic-fee-hook';
export {
  dedicatedSolanaCreateLaunchRequestSchema,
  genericSolanaCreateLaunchRequestSchema,
  isSolanaCanonicalNetwork,
  normalizeDedicatedSolanaCreateRequest,
  parseDedicatedSolanaCreateLaunchRequest,
  parseGenericSolanaCreateLaunchRequest,
} from './solana-schema';
export type {
  CreateSolanaLaunchRequestInput,
  DedicatedSolanaCreateLaunchRequestInput,
} from './solana-schema';
export {
  buildDisabledSolanaHookArgs,
  buildSolanaLaunchConfirmationLookupError,
  buildSolanaLaunchConfirmationTimeoutError,
  buildSolanaCpmmMigrationPayloads,
  buildSolanaLookupTableConfirmTimeoutError,
  buildSolanaLookupTableSubmitError,
  buildSolanaLookupTableWarmupTimeoutError,
  buildSolanaSimulationProgramError,
  buildSolanaSimulationRpcError,
  buildSolanaInitializeLaunchInstructionArgs,
  buildSolanaCosigningHookConfig,
  buildSolanaLaunchHookConfig,
  isSolanaSignatureConfirmed,
  throwIfSolanaSignatureRejected,
} from './solana-assembly';

const U64_MAX = 18_446_744_073_709_551_615n;
const SOLANA_NUMERAIRE_DECIMALS = 9;
const SOLANA_CONFIRM_POLL_INTERVAL_MS = 500;
const SOLANA_WSOL_MINT_ADDRESS = address('So11111111111111111111111111111111111111112');

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

interface SolanaInitializerConfig {
  address: Address;
  admin: Address;
  protocolFeeBps: number;
  minSwapFeeBps: number;
  maxSwapFeeBps: number;
}

interface SolanaResolvedFeeBeneficiaries {
  source: 'default' | 'request';
  beneficiaries: Array<{ wallet: Address; shareBps: number }>;
}

export const deriveSolanaLaunchSeed = (
  network: SolanaNetwork,
  idempotencyKey?: string,
): Uint8Array => {
  if (!idempotencyKey) {
    return randomBytes(32);
  }

  return createHash('sha256').update(`solana-launch:${network}:${idempotencyKey}`).digest();
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
  baseForDistribution: bigint;
  baseForLiquidity: bigint;
  numerairePriceUsd: number;
  marketCapStartUsd: number;
  marketCapEndUsd: number;
}): DerivedCurveConfig => {
  const baseForCurve = args.totalSupply - args.baseForDistribution - args.baseForLiquidity;
  if (baseForCurve <= 0n) {
    throw new AppError(
      422,
      'SOLANA_INVALID_CURVE',
      'economics.baseForDistribution + economics.baseForLiquidity must leave tokens for the curve',
    );
  }

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
    return this.config.solana.altAddress ? address(this.config.solana.altAddress) : undefined;
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

  async getLaunch(launchAddressInput: string): Promise<SolanaLaunchReadResponse> {
    this.assertEnabled();
    this.assertSupportedNetwork('solanaDevnet');

    let launchAddress: Address;
    try {
      launchAddress = address(launchAddressInput);
    } catch {
      throw new AppError(
        422,
        'SOLANA_INVALID_ADDRESS',
        'launchAddress must be a valid Solana address',
      );
    }

    let launch: Awaited<ReturnType<typeof initializer.fetchLaunch>>;
    try {
      launch = await initializer.fetchLaunch(this.rpc, launchAddress, {
        commitment: 'confirmed',
      });
    } catch (error) {
      throw new AppError(502, 'SOLANA_LOOKUP_FAILED', 'Failed to fetch Solana launch account', {
        cause: errorMessage(error),
      });
    }

    if (!launch) {
      throw new AppError(404, 'SOLANA_LAUNCH_NOT_FOUND', 'Solana launch was not found');
    }

    return {
      network: 'solanaDevnet',
      launchAddress,
      phase: {
        code: launch.phase,
        label: initializer.phaseLabel(launch.phase),
      },
      authority: launch.authority,
      namespace: launch.namespace,
      baseMint: launch.baseMint,
      quoteMint: launch.quoteMint,
      baseVault: launch.baseVault,
      quoteVault: launch.quoteVault,
      baseTotalSupply: launch.baseTotalSupply.toString(),
      baseForDistribution: launch.baseForDistribution.toString(),
      baseForLiquidity: launch.baseForLiquidity.toString(),
      baseForCurve: launch.baseForCurve.toString(),
      curveVirtualBase: launch.curveVirtualBase.toString(),
      curveVirtualQuote: launch.curveVirtualQuote.toString(),
      curveFeeBps: launch.swapFeeBps,
      swapFeeBps: launch.swapFeeBps,
      allowBuy: launch.allowBuy !== 0,
      allowSell: launch.allowSell !== 0,
      hookProgram: launch.hookProgram,
      hookFlags: launch.hookFlags,
      migratorProgram: launch.migratorProgram,
      quoteDeposited: launch.quoteDeposited.toString(),
      tokenDecimals: SOLANA_TOKEN_DECIMALS,
    };
  }

  private async launchAccountExists(launchAddress: Address): Promise<boolean> {
    try {
      const launchAccount = await fetchEncodedAccount(this.rpc, launchAddress, {
        commitment: 'confirmed',
      });
      return launchAccount.exists;
    } catch {
      return false;
    }
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

  private async fetchInitializerConfig(): Promise<SolanaInitializerConfig> {
    const [configAddress] = await initializer.getConfigAddress();
    const encodedAccount = await fetchEncodedAccount(this.rpc, configAddress, {
      commitment: 'confirmed',
    });
    const decodedAccount = decodeAccount(encodedAccount, initializer.getInitConfigDecoder());
    assertAccountExists(decodedAccount);
    return {
      address: configAddress,
      admin: decodedAccount.data.admin,
      protocolFeeBps: decodedAccount.data.protocolFeeBps,
      minSwapFeeBps: decodedAccount.data.minSwapFeeBps,
      maxSwapFeeBps: decodedAccount.data.maxSwapFeeBps,
    };
  }

  private resolveSwapFeeBps(
    input: CreateSolanaLaunchRequestInput,
    initializerConfig: SolanaInitializerConfig,
  ): number {
    const requested = input.auction.swapFeeBps ?? input.auction.curveFeeBps;
    const swapFeeBps = requested ?? initializerConfig.minSwapFeeBps;

    if (
      swapFeeBps < initializerConfig.minSwapFeeBps ||
      swapFeeBps > initializerConfig.maxSwapFeeBps
    ) {
      throw new AppError(
        422,
        'SOLANA_INVALID_CURVE',
        `Solana swapFeeBps must be between ${initializerConfig.minSwapFeeBps} and ${initializerConfig.maxSwapFeeBps}`,
      );
    }

    return swapFeeBps;
  }

  private resolveFeeBeneficiaries(
    input: CreateSolanaLaunchRequestInput,
    payerAddress: Address,
    initializerConfig: SolanaInitializerConfig,
  ): SolanaResolvedFeeBeneficiaries {
    const requested = input.feeBeneficiaries ?? [];
    const protocolBeneficiary = initializerConfig.admin;
    if (
      requested.length === 0 &&
      initializerConfig.protocolFeeBps < SOLANA_FEE_BPS_DENOMINATOR &&
      payerAddress === protocolBeneficiary
    ) {
      throw new AppError(
        422,
        'SOLANA_INVALID_FEE_BENEFICIARIES',
        'Solana feeBeneficiaries is required when the configured payer is the initializer protocol beneficiary',
        { protocolBeneficiary },
      );
    }

    const beneficiaries =
      requested.length > 0
        ? requested.map((beneficiary) => ({
            wallet: address(beneficiary.address),
            shareBps: beneficiary.shareBps,
          }))
        : initializerConfig.protocolFeeBps >= SOLANA_FEE_BPS_DENOMINATOR
          ? []
          : [{ wallet: payerAddress, shareBps: SOLANA_FEE_BPS_DENOMINATOR }];
    const protocolBeneficiaryIndex = beneficiaries.findIndex(
      (beneficiary) => beneficiary.wallet === protocolBeneficiary,
    );
    if (protocolBeneficiaryIndex !== -1) {
      throw new AppError(
        422,
        'SOLANA_INVALID_FEE_BENEFICIARIES',
        'Solana fee beneficiaries cannot include the initializer protocol beneficiary',
        {
          protocolBeneficiary,
          index: protocolBeneficiaryIndex,
        },
      );
    }

    return {
      source: requested.length > 0 ? 'request' : 'default',
      beneficiaries,
    };
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
      await this.fetchInitializerConfig();
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

    const supportCpmmMigration = input.migration?.supportCpmm ?? false;
    const totalSupply = BigInt(input.economics.totalSupply);
    const baseForDistribution = BigInt(input.economics.baseForDistribution ?? '0');
    const baseForLiquidity = BigInt(input.economics.baseForLiquidity ?? '0');
    if (!supportCpmmMigration && (baseForDistribution > 0n || baseForLiquidity > 0n)) {
      throw new AppError(
        422,
        'SOLANA_INVALID_ECONOMICS',
        'Solana launches without CPMM migration cannot reserve base tokens; omit baseForDistribution and baseForLiquidity or set migration.supportCpmm=true',
      );
    }
    const minimumQuoteRaise = supportCpmmMigration
      ? BigInt(input.migration?.minimumQuoteRaise ?? '0')
      : 0n;

    const tokensForSale = totalSupply - baseForDistribution - baseForLiquidity;
    const numeraireAddress = this.resolveNumeraireAddress(input);
    const numerairePriceUsd = await this.resolveNumerairePriceUsd(input, numeraireAddress);
    const allowBuy = input.auction.allowBuy ?? true;
    const allowSell = input.auction.allowSell ?? true;
    const curveConfig = deriveSolanaCurveConfig({
      totalSupply,
      baseForDistribution,
      baseForLiquidity,
      numerairePriceUsd,
      marketCapStartUsd: input.auction.curveConfig.marketCapStartUsd,
      marketCapEndUsd: input.auction.curveConfig.marketCapEndUsd,
    });

    const payer = await this.getPayerSigner();
    const initializerConfig = await this.fetchInitializerConfig();
    const swapFeeBps = this.resolveSwapFeeBps(input, initializerConfig);
    const feeBeneficiaries = this.resolveFeeBeneficiaries(input, payer.address, initializerConfig);
    const launchSeed = deriveSolanaLaunchSeed(input.network, idempotencyKey);
    const namespace = payer.address;
    const launchHookConfig = await buildSolanaLaunchHookConfig({
      dynamicFee: input.auction.dynamicFee,
      cosigningHook: input.auction.cosigningHook,
      namespace,
    });
    const [launchAddress] = await initializer.getLaunchAddress(namespace, launchSeed);
    const [launchAuthorityAddress] = await initializer.getLaunchAuthorityAddress(launchAddress);
    const [launchFeeStateAddress] = await initializer.getLaunchFeeStateAddress(launchAddress);
    const configAddress = initializerConfig.address;
    const baseMint = await generateKeyPairSigner();
    const baseVault = await generateKeyPairSigner();
    const quoteVault = await generateKeyPairSigner();
    const metadataAddress = await initializer.getTokenMetadataAddress(baseMint.address);
    const [payerBaseAta] = await findAssociatedTokenPda({
      owner: payer.address,
      mint: baseMint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [payerQuoteAta] = await findAssociatedTokenPda({
      owner: payer.address,
      mint: numeraireAddress,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const recipientAtas = supportCpmmMigration && baseForDistribution > 0n ? [payerBaseAta] : [];
    const migrationAccounts = supportCpmmMigration
      ? await cpmmMigrator.buildCpmmMigrationRemainingAccounts({
          launch: launchAddress,
          baseMint: baseMint.address,
          quoteMint: numeraireAddress,
          launchAuthority: launchAuthorityAddress,
          adminBaseAta: payerBaseAta,
          adminQuoteAta: payerQuoteAta,
          recipientAtas,
          cpmmProgram: cpmm.CPMM_PROGRAM_ID,
          cpmmMigratorProgram: cpmmMigrator.CPMM_MIGRATOR_PROGRAM_ID,
        })
      : null;
    const { migratorInitPayload, migratorMigratePayload } = buildSolanaCpmmMigrationPayloads({
      supportCpmmMigration,
      migrationAccounts,
      payerAddress: payer.address,
      baseForDistribution,
      baseForLiquidity,
      minimumQuoteRaise,
      swapFeeBps,
      feeBpsDenominator: SOLANA_FEE_BPS_DENOMINATOR,
    });

    const distinctAddresses = new Set([
      launchAddress,
      launchAuthorityAddress,
      launchFeeStateAddress,
      configAddress,
      baseMint.address,
      baseVault.address,
      quoteVault.address,
      metadataAddress,
      numeraireAddress,
    ]);
    if (distinctAddresses.size !== 9) {
      throw new AppError(
        500,
        'SOLANA_SUBMISSION_FAILED',
        'Derived Solana launch addresses are internally inconsistent',
      );
    }

    const [initializeAccounts, initializeArgs] = buildSolanaInitializeLaunchInstructionArgs({
      supportCpmmMigration,
      launchHookConfig,
      configAddress,
      launchAddress,
      launchAuthorityAddress,
      launchFeeStateAddress,
      baseMint,
      quoteMint: numeraireAddress,
      baseVault,
      quoteVault,
      metadataAddress,
      payer,
      namespace,
      launchSeed,
      totalSupply,
      baseForDistribution,
      baseForLiquidity,
      curveConfig,
      swapFeeBps,
      allowBuy,
      allowSell,
      migrationAccounts,
      migratorInitPayload,
      migratorMigratePayload,
      tokenMetadata: input.tokenMetadata,
      feeBeneficiaries: feeBeneficiaries.beneficiaries,
    });

    // The published SDK currently defines the initializer account list for this path.
    // Live Solana create remains dependent on the SDK/IDL staying in sync with the
    // deployed devnet program's initialize_launch accounts.
    const instruction = await initializer.createInitializeLaunchInstruction(
      initializeAccounts,
      initializeArgs,
    );

    let lookupTable: { lookupTableAddress: Address; addresses: readonly Address[] };
    const configuredAltAddress = this.getAltAddress();
    if (configuredAltAddress) {
      const lookupTables = await fetchAddressesForLookupTables([configuredAltAddress], this.rpc, {
        commitment: 'confirmed',
      });
      const configuredAltAddresses = lookupTables[configuredAltAddress];
      if (!configuredAltAddresses) {
        throw new AppError(
          503,
          'SOLANA_NOT_READY',
          'Configured Solana address lookup table is not available',
          { altAddress: configuredAltAddress },
        );
      }

      lookupTable = {
        lookupTableAddress: configuredAltAddress,
        addresses: configuredAltAddresses,
      };
    } else {
      const lookupTableAuthority = await generateKeyPairSigner();
      const recentSlot = await this.rpc.getSlot({ commitment: 'finalized' }).send();
      const lookupTableSetup = await initializer.buildAddressLookupTableSetupInstructions({
        authority: lookupTableAuthority,
        payer,
        recentSlot,
        addresses: initializer.getInstructionLookupTableAddresses(instruction),
      });
      lookupTable = {
        lookupTableAddress: lookupTableSetup.lookupTableAddress,
        addresses: lookupTableSetup.addresses,
      };

      const lookupTableSetupBlockhash = await this.rpc
        .getLatestBlockhash({ commitment: 'confirmed' })
        .send();
      const lookupTableSetupMessage = appendTransactionMessageInstructions(
        [lookupTableSetup.createInstruction, ...lookupTableSetup.extendInstructions],
        setTransactionMessageLifetimeUsingBlockhash(
          lookupTableSetupBlockhash.value,
          setTransactionMessageFeePayerSigner(payer, createTransactionMessage({ version: 0 })),
        ),
      );
      const signedLookupTableSetup =
        await signTransactionMessageWithSigners(lookupTableSetupMessage);
      const lookupTableSetupSignatureBytes = signedLookupTableSetup.signatures[payer.address];
      if (!lookupTableSetupSignatureBytes) {
        throw new AppError(
          500,
          'SOLANA_SUBMISSION_FAILED',
          'Failed to sign Solana lookup table setup transaction with the configured payer',
        );
      }
      const lookupTableSetupSignature = signature(
        getBase58Decoder().decode(lookupTableSetupSignatureBytes),
      );
      const lookupTableSetupWire = getBase64EncodedWireTransaction(signedLookupTableSetup);

      try {
        await this.rpc
          .sendTransaction(lookupTableSetupWire, {
            encoding: 'base64',
            preflightCommitment: 'confirmed',
            skipPreflight: false,
          })
          .send();
      } catch (error) {
        throw buildSolanaLookupTableSubmitError(errorMessage(error));
      }

      const lookupTableDeadline = Date.now() + this.config.solana.confirmTimeoutMs;
      for (;;) {
        let status: Parameters<typeof throwIfSolanaSignatureRejected>[0];
        try {
          const statuses = await this.rpc.getSignatureStatuses([lookupTableSetupSignature]).send();
          status = statuses.value[0];
        } catch (_error) {
          if (Date.now() >= lookupTableDeadline) {
            throw buildSolanaLookupTableConfirmTimeoutError();
          }

          await delay(SOLANA_CONFIRM_POLL_INTERVAL_MS);
          continue;
        }

        throwIfSolanaSignatureRejected(
          status,
          'Solana lookup table setup transaction was rejected after submission',
        );

        if (isSolanaSignatureConfirmed(status)) {
          break;
        }

        if (Date.now() >= lookupTableDeadline) {
          throw buildSolanaLookupTableConfirmTimeoutError();
        }

        await delay(SOLANA_CONFIRM_POLL_INTERVAL_MS);
      }

      let lookupTableSetupSlot: bigint;
      for (;;) {
        try {
          lookupTableSetupSlot = await this.rpc.getSlot({ commitment: 'confirmed' }).send();
          break;
        } catch (_error) {
          if (Date.now() >= lookupTableDeadline) {
            throw buildSolanaLookupTableWarmupTimeoutError();
          }

          await delay(SOLANA_CONFIRM_POLL_INTERVAL_MS);
        }
      }

      for (;;) {
        let currentSlot: bigint;
        try {
          currentSlot = await this.rpc.getSlot({ commitment: 'confirmed' }).send();
        } catch (_error) {
          if (Date.now() >= lookupTableDeadline) {
            throw buildSolanaLookupTableWarmupTimeoutError();
          }

          await delay(SOLANA_CONFIRM_POLL_INTERVAL_MS);
          continue;
        }

        if (currentSlot > lookupTableSetupSlot) {
          break;
        }

        if (Date.now() >= lookupTableDeadline) {
          throw buildSolanaLookupTableWarmupTimeoutError();
        }

        await delay(SOLANA_CONFIRM_POLL_INTERVAL_MS);
      }
    }

    const latestBlockhash = await this.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const uncompressedTransactionMessage = appendTransactionMessageInstructions(
      [instruction],
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash.value,
        setTransactionMessageFeePayerSigner(payer, createTransactionMessage({ version: 0 })),
      ),
    );
    const transactionMessage = initializer.compressTransactionMessageWithLookupTable(
      uncompressedTransactionMessage,
      lookupTable,
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
      throw buildSolanaSimulationRpcError(errorMessage(error));
    }

    const simulationLogs = simulation.value.logs ?? [];
    if (simulation.value.err) {
      throw buildSolanaSimulationProgramError(simulationLogs);
    }

    try {
      await this.rpc
        .sendTransaction(wireTransaction, {
          encoding: 'base64',
          preflightCommitment: 'confirmed',
          skipPreflight: false,
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
        let status: Parameters<typeof throwIfSolanaSignatureRejected>[0];
        try {
          const statuses = await this.rpc.getSignatureStatuses([transactionSignature]).send();
          status = statuses.value[0];
        } catch (_error) {
          if (await this.launchAccountExists(launchAddress)) {
            break;
          }

          if (Date.now() >= deadline) {
            throw buildSolanaLaunchConfirmationLookupError({
              launchId: launchAddress,
              signature: transactionSignature,
              explorerUrl,
            });
          }

          await delay(SOLANA_CONFIRM_POLL_INTERVAL_MS);
          continue;
        }

        throwIfSolanaSignatureRejected(
          status,
          'Solana launch transaction was rejected after submission',
        );

        if (isSolanaSignatureConfirmed(status)) {
          break;
        }

        if (Date.now() >= deadline) {
          if (await this.launchAccountExists(launchAddress)) {
            break;
          }

          throw buildSolanaLaunchConfirmationTimeoutError({
            launchId: launchAddress,
            signature: transactionSignature,
            explorerUrl,
          });
        }

        await delay(SOLANA_CONFIRM_POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw buildSolanaLaunchConfirmationLookupError({
        launchId: launchAddress,
        signature: transactionSignature,
        explorerUrl,
      });
    }

    return {
      launchId: launchAddress,
      network: input.network,
      signature: transactionSignature,
      explorerUrl,
      statusUrl: `/v1/solana/launches/${launchAddress}`,
      predicted: {
        tokenAddress: baseMint.address,
        launchAuthorityAddress,
        launchFeeStateAddress,
        baseVaultAddress: baseVault.address,
        quoteVaultAddress: quoteVault.address,
      },
      effectiveConfig: {
        tokensForSale: tokensForSale.toString(),
        allocationAmount: baseForDistribution.toString(),
        baseForDistribution: baseForDistribution.toString(),
        baseForLiquidity: baseForLiquidity.toString(),
        allocationLockMode: 'none',
        numeraireAddress,
        numerairePriceUsd,
        curveVirtualBase: curveConfig.curveVirtualBase.toString(),
        curveVirtualQuote: curveConfig.curveVirtualQuote.toString(),
        curveFeeBps: swapFeeBps,
        swapFeeBps,
        feeBeneficiariesSource: feeBeneficiaries.source,
        feeBeneficiaries: feeBeneficiaries.beneficiaries.map((beneficiary) => ({
          address: beneficiary.wallet,
          shareBps: beneficiary.shareBps,
        })),
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
  systemProgramAddress: SOLANA_SYSTEM_PROGRAM_ADDRESS,
  rentSysvarAddress: SOLANA_RENT_SYSVAR_ADDRESS,
  cpmmHookProgramId: initializer.CPMM_HOOK_PROGRAM_ID,
  cosignerHookProgramId: cosignerHook.COSIGNER_HOOK_PROGRAM_ID,
  dynamicFeeHookProgramId: dynamicFeeHook.DYNAMIC_FEE_HOOK_PROGRAM_ID,
  cpmmMigratorProgramId: cpmmMigrator.CPMM_MIGRATOR_PROGRAM_ID,
  disabledHookRemainingAccountsHash: SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH,
  feeBpsDenominator: SOLANA_FEE_BPS_DENOMINATOR,
  maxFeeBeneficiaries: SOLANA_MAX_FEE_BENEFICIARIES,
};
