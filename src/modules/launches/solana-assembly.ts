import { address, type Address } from '@solana/kit';
import type { generateKeyPairSigner } from '@solana/kit';
import {
  cosignerHook,
  cpmm,
  cpmmMigrator,
  initializer,
} from '@whetstone-research/doppler-sdk/solana';

import { AppError } from '../../core/errors';
import type { CreateSolanaLaunchRequestInput } from './solana-schema';

export const SOLANA_TOKEN_DECIMALS = 6;
export const SOLANA_SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');
export const SOLANA_RENT_SYSVAR_ADDRESS = address('SysvarRent111111111111111111111111111111111');
export const SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH = new Uint8Array(32);

type SolanaSigner = Awaited<ReturnType<typeof generateKeyPairSigner>>;
type SolanaInitializeLaunchAccounts = Parameters<
  typeof initializer.createInitializeLaunchInstruction
>[0];
type SolanaInitializeLaunchArgs = Parameters<
  typeof initializer.createInitializeLaunchInstruction
>[1];
type SolanaCpmmMigrationAccounts = Awaited<
  ReturnType<typeof cpmmMigrator.buildCpmmMigrationRemainingAccounts>
>;
type SolanaParsedProgramError = ReturnType<typeof cpmm.parseErrorFromLogs>;
type SolanaSignatureStatus = {
  err?: unknown;
  confirmationStatus?: string | null;
} | null;
export type SolanaCosigningHookConfig = {
  hookProgram: Address;
  hookFlags: number;
  hookPayload: Uint8Array;
  hookRemainingAccounts: Address[];
  hookRemainingAccountsHash: Uint8Array;
};

export const buildDisabledSolanaHookArgs = () => ({
  hookFlags: 0,
  hookPayload: new Uint8Array(),
  hookCreateRemainingAccountsLen: 0,
  hookCreateRemainingAccountsHash: new Uint8Array(SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH),
  hookRemainingAccountsHash: new Uint8Array(SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH),
  migratorInitPayload: new Uint8Array(),
  migratorMigratePayload: new Uint8Array(),
  migratorInitRemainingAccountsHash: new Uint8Array(SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH),
  migratorRemainingAccountsHash: new Uint8Array(SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH),
});

const toCosignerHookExpiryMode = (
  mode: Exclude<
    NonNullable<
      NonNullable<CreateSolanaLaunchRequestInput['auction']['cosigningHook']>['expiry']
    >['mode'],
    'disabled'
  >,
): 1 | 2 => {
  if (mode === 'unixTimestamp') return cosignerHook.GATE_EXPIRY_UNIX_TIMESTAMP;
  return cosignerHook.GATE_EXPIRY_SLOT;
};

export const buildSolanaCosigningHookConfig = (
  hook: CreateSolanaLaunchRequestInput['auction']['cosigningHook'],
): Promise<SolanaCosigningHookConfig | null> => {
  if (!hook) {
    return Promise.resolve(null);
  }

  return cosignerHook.getCosignerHookConfigAddress().then(([configAddress]) => {
    const hookPayload =
      !hook.expiry || hook.expiry.mode === 'disabled'
        ? cosignerHook.encodeCosignerGateExpiryPayload({
            mode: cosignerHook.GATE_EXPIRY_DISABLED,
            value: 0n,
          })
        : cosignerHook.encodeCosignerGateExpiryPayload({
            mode: toCosignerHookExpiryMode(hook.expiry.mode),
            value: BigInt(hook.expiry.value!),
            cosigner: address(hook.cosigner),
          });
    const hookRemainingAccounts = [configAddress, address(hook.cosigner)];

    return {
      hookProgram: cosignerHook.COSIGNER_HOOK_PROGRAM_ID,
      hookFlags: initializer.HF_BEFORE_SWAP | initializer.HF_FORWARD_READONLY_SIGNERS,
      hookPayload,
      hookRemainingAccounts,
      hookRemainingAccountsHash: initializer.computeRemainingAccountsHash(hookRemainingAccounts),
    };
  });
};

export const buildSolanaInitializeLaunchInstructionArgs = (args: {
  supportCpmmMigration: boolean;
  cosigningHookConfig: SolanaCosigningHookConfig | null;
  configAddress: Address;
  launchAddress: Address;
  launchAuthorityAddress: Address;
  launchFeeStateAddress: Address;
  baseMint: SolanaSigner;
  quoteMint: Address;
  baseVault: SolanaSigner;
  quoteVault: SolanaSigner;
  metadataAddress: Address;
  payer: SolanaSigner;
  namespace: Address;
  launchSeed: Uint8Array;
  totalSupply: bigint;
  baseForDistribution: bigint;
  baseForLiquidity: bigint;
  curveConfig: {
    curveVirtualBase: bigint;
    curveVirtualQuote: bigint;
  };
  swapFeeBps: number;
  allowBuy: boolean;
  allowSell: boolean;
  migrationAccounts: SolanaCpmmMigrationAccounts | null;
  migratorInitPayload: Uint8Array;
  migratorMigratePayload: Uint8Array;
  tokenMetadata: CreateSolanaLaunchRequestInput['tokenMetadata'];
  feeBeneficiaries: Array<{ wallet: Address; shareBps: number }>;
}): [SolanaInitializeLaunchAccounts, SolanaInitializeLaunchArgs] => {
  const accounts: SolanaInitializeLaunchAccounts = {
    config: args.configAddress,
    launch: args.launchAddress,
    launchAuthority: args.launchAuthorityAddress,
    baseMint: args.baseMint,
    quoteMint: args.quoteMint,
    baseVault: args.baseVault,
    quoteVault: args.quoteVault,
    launchFeeState: args.launchFeeStateAddress,
    payer: args.payer,
    authority: args.payer,
    hookProgram:
      args.cosigningHookConfig?.hookProgram ??
      (args.supportCpmmMigration
        ? initializer.CPMM_HOOK_PROGRAM_ID
        : SOLANA_SYSTEM_PROGRAM_ADDRESS),
    migratorProgram: args.supportCpmmMigration
      ? cpmmMigrator.CPMM_MIGRATOR_PROGRAM_ID
      : SOLANA_SYSTEM_PROGRAM_ADDRESS,
    ...(args.supportCpmmMigration &&
      args.migrationAccounts && {
        cpmmConfig: args.migrationAccounts.cpmmConfig,
      }),
    rent: SOLANA_RENT_SYSVAR_ADDRESS,
    metadataAccount: args.metadataAddress,
  };

  const instructionArgs: SolanaInitializeLaunchArgs = {
    namespace: args.namespace,
    launchId: args.launchSeed,
    baseDecimals: SOLANA_TOKEN_DECIMALS,
    baseTotalSupply: args.totalSupply,
    baseForDistribution: args.baseForDistribution,
    baseForLiquidity: args.baseForLiquidity,
    curveVirtualBase: args.curveConfig.curveVirtualBase,
    curveVirtualQuote: args.curveConfig.curveVirtualQuote,
    swapFeeBps: args.swapFeeBps,
    curveKind: initializer.CURVE_KIND_XYK,
    curveParams: new Uint8Array([initializer.CURVE_PARAMS_FORMAT_XYK_V0]),
    allowBuy: args.allowBuy,
    allowSell: args.allowSell,
    ...(args.cosigningHookConfig
      ? {
          hookFlags: args.cosigningHookConfig.hookFlags,
          hookPayload: args.cosigningHookConfig.hookPayload,
          hookCreateRemainingAccountsLen: 0,
          hookCreateRemainingAccountsHash: new Uint8Array(
            SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH,
          ),
          hookRemainingAccountsHash: args.cosigningHookConfig.hookRemainingAccountsHash,
          migratorInitPayload: new Uint8Array(),
          migratorMigratePayload: new Uint8Array(),
          migratorInitRemainingAccountsHash: new Uint8Array(
            SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH,
          ),
          migratorRemainingAccountsHash: new Uint8Array(
            SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH,
          ),
        }
      : args.supportCpmmMigration && args.migrationAccounts
        ? {
            hookFlags: initializer.HF_BEFORE_SWAP,
            hookPayload: new Uint8Array(),
            hookCreateRemainingAccountsLen: 0,
            hookCreateRemainingAccountsHash: new Uint8Array(
              SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH,
            ),
            hookRemainingAccountsHash: args.migrationAccounts.hash,
            migratorInitPayload: args.migratorInitPayload,
            migratorMigratePayload: args.migratorMigratePayload,
            migratorInitRemainingAccountsHash: initializer.computeRemainingAccountsHash([
              args.migrationAccounts.cpmmMigrationState,
              args.migrationAccounts.cpmmConfig,
            ]),
            migratorRemainingAccountsHash: args.migrationAccounts.hash,
          }
        : buildDisabledSolanaHookArgs()),
    metadataName: args.tokenMetadata.name,
    metadataSymbol: args.tokenMetadata.symbol,
    metadataUri: args.tokenMetadata.tokenURI,
    feeBeneficiaries: args.feeBeneficiaries,
  };

  return [accounts, instructionArgs];
};

export const buildSolanaCpmmMigrationPayloads = (args: {
  supportCpmmMigration: boolean;
  migrationAccounts: SolanaCpmmMigrationAccounts | null;
  payerAddress: Address;
  baseForDistribution: bigint;
  baseForLiquidity: bigint;
  minimumQuoteRaise: bigint;
  swapFeeBps: number;
  feeBpsDenominator: number;
  encodeRegisterLaunchPayload?: typeof cpmmMigrator.encodeRegisterLaunchPayload;
  encodeMigratePayload?: typeof cpmmMigrator.encodeMigratePayload;
}): {
  migrationRecipients: Array<{ wallet: Address; amount: bigint }>;
  migratorInitPayload: Uint8Array;
  migratorMigratePayload: Uint8Array;
} => {
  if (!args.supportCpmmMigration || !args.migrationAccounts) {
    return {
      migrationRecipients: [],
      migratorInitPayload: new Uint8Array(),
      migratorMigratePayload: new Uint8Array(),
    };
  }

  const migrationRecipients =
    args.baseForDistribution > 0n
      ? [{ wallet: args.payerAddress, amount: args.baseForDistribution }]
      : [];
  const encodeRegisterLaunchPayload =
    args.encodeRegisterLaunchPayload ?? cpmmMigrator.encodeRegisterLaunchPayload;
  const encodeMigratePayload = args.encodeMigratePayload ?? cpmmMigrator.encodeMigratePayload;

  return {
    migrationRecipients,
    migratorInitPayload: encodeRegisterLaunchPayload({
      cpmmConfig: args.migrationAccounts.cpmmConfig,
      initialSwapFeeBps: args.swapFeeBps,
      initialFeeSplitBps: args.feeBpsDenominator,
      recipients: migrationRecipients,
      minRaiseQuote: args.minimumQuoteRaise,
      minMigrationPriceQ64Opt: null,
      migratedPoolHookConfig: null,
    }),
    migratorMigratePayload: encodeMigratePayload({
      baseForDistribution: args.baseForDistribution,
      baseForLiquidity: args.baseForLiquidity,
    }),
  };
};

export const isSolanaSignatureConfirmed = (status: SolanaSignatureStatus): boolean =>
  status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized';

export const throwIfSolanaSignatureRejected = (
  status: SolanaSignatureStatus,
  message: string,
): void => {
  if (!status?.err) {
    return;
  }

  throw new AppError(502, 'SOLANA_SUBMISSION_FAILED', message, { status: status.err });
};

export const buildSolanaLookupTableSubmitError = (cause: string): AppError =>
  new AppError(
    502,
    'SOLANA_SUBMISSION_FAILED',
    'Failed to submit Solana lookup table setup transaction',
    { cause },
  );

export const buildSolanaLookupTableConfirmTimeoutError = (): AppError =>
  new AppError(
    502,
    'SOLANA_SUBMISSION_FAILED',
    'Solana lookup table setup transaction did not confirm before timeout',
  );

export const buildSolanaLookupTableWarmupTimeoutError = (): AppError =>
  new AppError(
    502,
    'SOLANA_SUBMISSION_FAILED',
    'Solana lookup table setup did not warm up before timeout',
  );

export const buildSolanaSimulationRpcError = (cause: string): AppError =>
  new AppError(502, 'SOLANA_SIMULATION_FAILED', 'Failed to simulate Solana launch transaction', {
    cause,
  });

export const buildSolanaSimulationProgramError = (
  logs: string[],
  parseErrorFromLogs: (logs: string[]) => SolanaParsedProgramError = cpmm.parseErrorFromLogs,
): AppError => {
  const parsedError = parseErrorFromLogs(logs);
  return new AppError(
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
          logs,
        }
      : { logs },
  );
};

export const buildSolanaLaunchConfirmationTimeoutError = (args: {
  launchId: Address;
  signature: string;
  explorerUrl: string;
}): AppError =>
  new AppError(
    409,
    'IDEMPOTENCY_KEY_IN_DOUBT',
    'Solana launch submission completed but confirmation did not resolve before timeout',
    {
      launchId: args.launchId,
      signature: args.signature,
      explorerUrl: args.explorerUrl,
    },
  );

export const buildSolanaLaunchConfirmationLookupError = (args: {
  launchId: Address;
  signature: string;
  explorerUrl: string;
}): AppError =>
  new AppError(
    409,
    'IDEMPOTENCY_KEY_IN_DOUBT',
    'Solana launch submission completed but confirmation could not be verified',
    {
      launchId: args.launchId,
      signature: args.signature,
      explorerUrl: args.explorerUrl,
    },
  );
