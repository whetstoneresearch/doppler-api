import {
  appendTransactionMessageInstructions,
  createDefaultRpcTransport,
  createKeyPairSignerFromBytes,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  isSolanaError,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signature,
  signTransactionMessageWithSigners,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Address,
  type RpcTransport,
} from '@solana/kit';
import { initializer } from '@whetstone-research/doppler-sdk/solana';

import { AppError } from '../../core/errors';
import {
  buildSolanaLookupTableConfirmTimeoutError,
  buildSolanaLookupTableSubmitError,
  buildSolanaLookupTableWarmupTimeoutError,
  isSolanaSignatureConfirmed,
  throwIfSolanaSignatureRejected,
} from './solana-assembly';

const SOLANA_CONFIRM_POLL_INTERVAL_MS = 500;
const SOLANA_RPC_MAX_ATTEMPTS = 5;
const SOLANA_RPC_RETRY_BASE_DELAY_MS = 250;
const SOLANA_TRANSACTION_MAX_BYTES = 1_232;

type SolanaPayerSigner = Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;
type SolanaInitializeLaunchInstruction = Awaited<
  ReturnType<typeof initializer.createInitializeLaunchInstruction>
>;

export interface SolanaLookupTable {
  lookupTableAddress: Address;
  addresses: readonly Address[];
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'dependency unavailable';
};

export const withSolanaRpcRateLimitRetries = async <T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> => {
  const maxAttempts = options.maxAttempts ?? SOLANA_RPC_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? SOLANA_RPC_RETRY_BASE_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const isRateLimited =
        isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
        error.context.statusCode === 429;
      if (!isRateLimited || attempt === maxAttempts) {
        throw error;
      }

      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw new Error('Solana RPC retry loop exhausted unexpectedly');
};

export const createRetryingSolanaRpc = (rpcUrl: string) => {
  const transport = createDefaultRpcTransport({ url: rpcUrl });
  const retryingTransport: RpcTransport = async <TResponse>(config: Parameters<RpcTransport>[0]) =>
    withSolanaRpcRateLimitRetries(() => transport<TResponse>(config));

  return createSolanaRpcFromTransport(retryingTransport);
};

export const isSolanaTransactionPacketTooLarge = (wireTransaction: string): boolean =>
  Buffer.byteLength(wireTransaction, 'base64') > SOLANA_TRANSACTION_MAX_BYTES;

export const createLaunchSpecificLookupTable = async (args: {
  rpc: ReturnType<typeof createRetryingSolanaRpc>;
  payer: SolanaPayerSigner;
  instruction: SolanaInitializeLaunchInstruction;
  confirmTimeoutMs: number;
}): Promise<SolanaLookupTable> => {
  const lookupTableAuthority = await generateKeyPairSigner();
  const recentSlot = await args.rpc.getSlot({ commitment: 'finalized' }).send();
  const lookupTableSetup = await initializer.buildAddressLookupTableSetupInstructions({
    authority: lookupTableAuthority,
    payer: args.payer,
    recentSlot,
    addresses: initializer.getInstructionLookupTableAddresses(args.instruction),
  });
  const lookupTable = {
    lookupTableAddress: lookupTableSetup.lookupTableAddress,
    addresses: lookupTableSetup.addresses,
  };

  const lookupTableSetupBlockhash = await args.rpc
    .getLatestBlockhash({ commitment: 'confirmed' })
    .send();
  const lookupTableSetupMessage = appendTransactionMessageInstructions(
    [lookupTableSetup.createInstruction, ...lookupTableSetup.extendInstructions],
    setTransactionMessageLifetimeUsingBlockhash(
      lookupTableSetupBlockhash.value,
      setTransactionMessageFeePayerSigner(args.payer, createTransactionMessage({ version: 0 })),
    ),
  );
  const signedLookupTableSetup = await signTransactionMessageWithSigners(lookupTableSetupMessage);
  const lookupTableSetupSignatureBytes = signedLookupTableSetup.signatures[args.payer.address];
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
    await args.rpc
      .sendTransaction(lookupTableSetupWire, {
        encoding: 'base64',
        preflightCommitment: 'confirmed',
        skipPreflight: false,
      })
      .send();
  } catch (error) {
    throw buildSolanaLookupTableSubmitError(errorMessage(error));
  }

  const lookupTableDeadline = Date.now() + args.confirmTimeoutMs;
  for (;;) {
    let status: Parameters<typeof throwIfSolanaSignatureRejected>[0];
    try {
      const statuses = await args.rpc.getSignatureStatuses([lookupTableSetupSignature]).send();
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
      lookupTableSetupSlot = await args.rpc.getSlot({ commitment: 'confirmed' }).send();
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
      currentSlot = await args.rpc.getSlot({ commitment: 'confirmed' }).send();
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

  return lookupTable;
};
