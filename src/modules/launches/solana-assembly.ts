import { address, type Address } from '@solana/kit';
import type { generateKeyPairSigner } from '@solana/kit';
import {
  cosignerHook,
  cpmm,
  cpmmMigrator,
  initializer,
} from '@whetstone-research/doppler-sdk/solana';

import { AppError } from '../../core/errors';
import * as dynamicFeeHook from './solana-dynamic-fee-hook';
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
type SolanaCpmmMigrationAccounts = {
  cpmmMigrationState: Address;
  cpmmConfig: Address;
  hash: Uint8Array;
};
type SolanaParsedProgramError = ReturnType<typeof cpmm.parseErrorFromLogs>;
type SolanaSignatureStatus = {
  err?: unknown;
  confirmationStatus?: string | null;
} | null;
export type SolanaLaunchHookConfig = {
  hookProgram: Address;
  hookFlags: number;
  hookPayload: Uint8Array;
  hookCreateRemainingAccountsLen: number;
  hookCreateRemainingAccountsHash: Uint8Array;
  hookRemainingAccounts: Address[];
  hookRemainingAccountsHash: Uint8Array;
};

export type SolanaCosigningHookConfig = SolanaLaunchHookConfig;

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

const buildCosignerGateExpiry = (
  hook: CreateSolanaLaunchRequestInput['auction']['cosigningHook'],
):
  | {
      mode: typeof cosignerHook.GATE_EXPIRY_DISABLED;
      value: 0n;
    }
  | {
      mode: typeof cosignerHook.GATE_EXPIRY_UNIX_TIMESTAMP | typeof cosignerHook.GATE_EXPIRY_SLOT;
      value: bigint;
      cosigner: Address;
    }
  | null => {
  if (!hook) {
    return null;
  }

  if (!hook.expiry || hook.expiry.mode === 'disabled') {
    return {
      mode: cosignerHook.GATE_EXPIRY_DISABLED,
      value: 0n,
    };
  }

  const expiryValue = hook.expiry.value;
  if (expiryValue === undefined) {
    throw new Error('cosigner hook expiry value is required');
  }

  return {
    mode: toCosignerHookExpiryMode(hook.expiry.mode),
    value: BigInt(expiryValue),
    cosigner: address(hook.cosigner),
  };
};

const buildStandaloneCosigningHookConfig = (args: {
  hook: NonNullable<CreateSolanaLaunchRequestInput['auction']['cosigningHook']>;
  namespace: Address;
  configAddress: Address;
}): SolanaCosigningHookConfig => {
  const cosigner = address(args.hook.cosigner);
  const gateExpiry = buildCosignerGateExpiry(args.hook);
  const hookPayload = gateExpiry
    ? cosignerHook.encodeCosignerGateExpiryPayload(gateExpiry)
    : new Uint8Array();
  const hookRemainingAccounts =
    args.namespace === args.configAddress
      ? [args.configAddress, cosigner]
      : [args.namespace, args.configAddress, cosigner];

  return {
    hookProgram: cosignerHook.COSIGNER_HOOK_PROGRAM_ID,
    hookFlags: initializer.HF_BEFORE_SWAP | initializer.HF_FORWARD_READONLY_SIGNERS,
    hookPayload,
    hookCreateRemainingAccountsLen: 0,
    hookCreateRemainingAccountsHash: new Uint8Array(SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH),
    hookRemainingAccounts,
    hookRemainingAccountsHash: initializer.computeRemainingAccountsHash(hookRemainingAccounts),
  };
};

const buildDynamicFeeLaunchHookConfig = async (args: {
  dynamicFee: CreateSolanaLaunchRequestInput['auction']['dynamicFee'];
  cosigningHook: CreateSolanaLaunchRequestInput['auction']['cosigningHook'];
  namespace: Address;
}): Promise<SolanaLaunchHookConfig> => {
  const cosigner = args.cosigningHook ? address(args.cosigningHook.cosigner) : undefined;
  const configAddress = cosigner
    ? (await dynamicFeeHook.getDynamicFeeHookConfigAddress())[0]
    : undefined;
  const remainingAccounts = dynamicFeeHook.getDynamicFeeHookRemainingAccounts({
    namespace: args.namespace,
    config: configAddress,
    cosigner,
  });
  const hasSchedule = args.dynamicFee !== undefined;
  const gateExpiry = buildCosignerGateExpiry(args.cosigningHook);

  return {
    hookProgram: dynamicFeeHook.DYNAMIC_FEE_HOOK_PROGRAM_ID,
    hookFlags:
      initializer.HF_BEFORE_SWAP |
      (hasSchedule ? initializer.HF_BEFORE_CREATE : 0) |
      (cosigner ? initializer.HF_FORWARD_READONLY_SIGNERS : 0),
    hookPayload: dynamicFeeHook.encodeDynamicFeeHookPayload({
      schedule: args.dynamicFee
        ? {
            startingTime: BigInt(args.dynamicFee.startingTime ?? '0'),
            startFeeBps: args.dynamicFee.startFeeBps,
            endFeeBps: args.dynamicFee.endFeeBps,
            durationSeconds: BigInt(args.dynamicFee.durationSeconds),
          }
        : null,
      gateExpiry,
    }),
    hookCreateRemainingAccountsLen: 0,
    hookCreateRemainingAccountsHash: hasSchedule
      ? initializer.computeRemainingAccountsHash([])
      : new Uint8Array(SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH),
    hookRemainingAccounts: remainingAccounts.unsignedHookRemainingAccounts,
    hookRemainingAccountsHash: remainingAccounts.hookRemainingAccountsHash,
  };
};

export const buildSolanaLaunchHookConfig = async (args: {
  dynamicFee: CreateSolanaLaunchRequestInput['auction']['dynamicFee'];
  cosigningHook: CreateSolanaLaunchRequestInput['auction']['cosigningHook'];
  namespace: Address;
}): Promise<SolanaLaunchHookConfig | null> => {
  if (args.dynamicFee) {
    return buildDynamicFeeLaunchHookConfig(args);
  }
  if (!args.cosigningHook) {
    return null;
  }

  const [configAddress] = await cosignerHook.getCosignerHookConfigAddress();
  return buildStandaloneCosigningHookConfig({
    hook: args.cosigningHook,
    namespace: args.namespace,
    configAddress,
  });
};

export const buildSolanaCosigningHookConfig = async (
  hook: CreateSolanaLaunchRequestInput['auction']['cosigningHook'],
): Promise<SolanaCosigningHookConfig | null> => {
  if (!hook) {
    return null;
  }

  const [configAddress] = await cosignerHook.getCosignerHookConfigAddress();
  return buildStandaloneCosigningHookConfig({
    hook,
    namespace: configAddress,
    configAddress,
  });
};

export const buildSolanaInitializeLaunchInstructionArgs = (args: {
  supportCpmmMigration: boolean;
  launchHookConfig: SolanaLaunchHookConfig | null;
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
      args.launchHookConfig?.hookProgram ??
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
  const disabledHookArgs = buildDisabledSolanaHookArgs();

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
    ...(args.launchHookConfig
      ? {
          hookFlags: args.launchHookConfig.hookFlags,
          hookPayload: args.launchHookConfig.hookPayload,
          hookCreateRemainingAccountsLen: args.launchHookConfig.hookCreateRemainingAccountsLen,
          hookCreateRemainingAccountsHash: args.launchHookConfig.hookCreateRemainingAccountsHash,
          hookRemainingAccountsHash: args.launchHookConfig.hookRemainingAccountsHash,
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
          }
        : {
            hookFlags: disabledHookArgs.hookFlags,
            hookPayload: disabledHookArgs.hookPayload,
            hookCreateRemainingAccountsLen: disabledHookArgs.hookCreateRemainingAccountsLen,
            hookCreateRemainingAccountsHash: disabledHookArgs.hookCreateRemainingAccountsHash,
            hookRemainingAccountsHash: disabledHookArgs.hookRemainingAccountsHash,
          }),
    ...(args.supportCpmmMigration && args.migrationAccounts
      ? {
          migratorInitPayload: args.migratorInitPayload,
          migratorMigratePayload: args.migratorMigratePayload,
          migratorInitRemainingAccountsHash: initializer.computeRemainingAccountsHash([
            args.migrationAccounts.cpmmMigrationState,
            args.migrationAccounts.cpmmConfig,
          ]),
          migratorRemainingAccountsHash: args.migrationAccounts.hash,
        }
      : {
          migratorInitPayload: new Uint8Array(),
          migratorMigratePayload: new Uint8Array(),
          migratorInitRemainingAccountsHash: new Uint8Array(
            SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH,
          ),
          migratorRemainingAccountsHash: new Uint8Array(
            SOLANA_DISABLED_HOOK_REMAINING_ACCOUNTS_HASH,
          ),
        }),
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
