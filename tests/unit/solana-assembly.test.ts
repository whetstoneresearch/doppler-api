import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { cosignerHook, dynamicFeeHook, initializer } from '@whetstone-research/doppler-sdk/solana';

import {
  SOLANA_CONSTANTS,
  buildDisabledSolanaHookArgs,
  buildSolanaCpmmMigrationPayloads,
  buildSolanaCosigningHookConfig,
  buildSolanaInitializeLaunchInstructionArgs,
  buildSolanaLaunchHookConfig,
  buildSolanaLaunchConfirmationLookupError,
  buildSolanaLaunchConfirmationTimeoutError,
  buildSolanaLookupTableConfirmTimeoutError,
  buildSolanaLookupTableSubmitError,
  buildSolanaLookupTableWarmupTimeoutError,
  buildSolanaSimulationProgramError,
  buildSolanaSimulationRpcError,
  isSolanaSignatureConfirmed,
  throwIfSolanaSignatureRejected,
} from '../../src/modules/launches/solana';

describe('Solana SDK assembly helpers', () => {
  it('uses all-zero remaining-account hashes for disabled Solana hooks', () => {
    const disabledHookArgs = buildDisabledSolanaHookArgs();
    const zeroHash = Array.from(SOLANA_CONSTANTS.disabledHookRemainingAccountsHash);

    expect(zeroHash).toHaveLength(32);
    expect(zeroHash.every((value) => value === 0)).toBe(true);
    expect(zeroHash).not.toEqual(Array.from(initializer.EMPTY_REMAINING_ACCOUNTS_HASH));
    expect(Array.from(disabledHookArgs.hookCreateRemainingAccountsHash)).toEqual(zeroHash);
    expect(Array.from(disabledHookArgs.hookRemainingAccountsHash)).toEqual(zeroHash);
    expect(Array.from(disabledHookArgs.migratorInitRemainingAccountsHash)).toEqual(zeroHash);
    expect(Array.from(disabledHookArgs.migratorRemainingAccountsHash)).toEqual(zeroHash);
    expect(disabledHookArgs.hookFlags).toBe(0);
    expect(disabledHookArgs.hookCreateRemainingAccountsLen).toBe(0);
    expect(disabledHookArgs.hookPayload).toHaveLength(0);
    expect(disabledHookArgs.migratorInitPayload).toHaveLength(0);
    expect(disabledHookArgs.migratorMigratePayload).toHaveLength(0);
  });

  it('assembles basic non-CPMM Solana create instruction inputs for the SDK', async () => {
    const payer = await generateKeyPairSigner();
    const config = await generateKeyPairSigner();
    const launch = await generateKeyPairSigner();
    const launchAuthority = await generateKeyPairSigner();
    const launchFeeState = await generateKeyPairSigner();
    const baseMint = await generateKeyPairSigner();
    const baseVault = await generateKeyPairSigner();
    const quoteVault = await generateKeyPairSigner();
    const metadata = await generateKeyPairSigner();
    const beneficiary = await generateKeyPairSigner();
    const launchSeed = new Uint8Array(32).fill(9);
    const feeBeneficiaries = [
      { wallet: beneficiary.address, shareBps: SOLANA_CONSTANTS.feeBpsDenominator },
    ];

    const [accounts, instructionArgs] = buildSolanaInitializeLaunchInstructionArgs({
      supportCpmmMigration: false,
      launchHookConfig: null,
      configAddress: config.address,
      launchAddress: launch.address,
      launchAuthorityAddress: launchAuthority.address,
      launchFeeStateAddress: launchFeeState.address,
      baseMint,
      quoteMint: SOLANA_CONSTANTS.wsolMintAddress,
      baseVault,
      quoteVault,
      metadataAddress: metadata.address,
      payer,
      namespace: payer.address,
      launchSeed,
      totalSupply: 1_000_000_000n,
      baseForDistribution: 0n,
      baseForLiquidity: 0n,
      curveConfig: {
        curveVirtualBase: 123_000n,
        curveVirtualQuote: 456_000n,
      },
      swapFeeBps: 75,
      allowBuy: true,
      allowSell: false,
      migrationAccounts: null,
      migratorInitPayload: new Uint8Array(),
      migratorMigratePayload: new Uint8Array(),
      tokenMetadata: {
        name: 'SDK Shape',
        symbol: 'SDK',
        tokenURI: 'ipfs://sdk-shape',
      },
      feeBeneficiaries,
    });

    expect(accounts).toMatchObject({
      config: config.address,
      launch: launch.address,
      launchAuthority: launchAuthority.address,
      baseMint,
      quoteMint: SOLANA_CONSTANTS.wsolMintAddress,
      baseVault,
      quoteVault,
      launchFeeState: launchFeeState.address,
      payer,
      authority: payer,
      hookProgram: SOLANA_CONSTANTS.systemProgramAddress,
      migratorProgram: SOLANA_CONSTANTS.systemProgramAddress,
      rent: SOLANA_CONSTANTS.rentSysvarAddress,
      metadataAccount: metadata.address,
    });
    expect('cpmmConfig' in accounts).toBe(false);
    expect(instructionArgs).toMatchObject({
      namespace: payer.address,
      baseDecimals: SOLANA_CONSTANTS.tokenDecimals,
      baseTotalSupply: 1_000_000_000n,
      baseForDistribution: 0n,
      baseForLiquidity: 0n,
      curveVirtualBase: 123_000n,
      curveVirtualQuote: 456_000n,
      swapFeeBps: 75,
      allowBuy: true,
      allowSell: false,
      hookFlags: 0,
      hookCreateRemainingAccountsLen: 0,
      metadataName: 'SDK Shape',
      metadataSymbol: 'SDK',
      metadataUri: 'ipfs://sdk-shape',
      feeBeneficiaries,
    });
    expect(Array.from(instructionArgs.launchId)).toEqual(Array.from(launchSeed));
    expect(Array.from(instructionArgs.hookCreateRemainingAccountsHash!)).toEqual(
      Array.from(SOLANA_CONSTANTS.disabledHookRemainingAccountsHash),
    );
    expect(Array.from(instructionArgs.hookRemainingAccountsHash!)).toEqual(
      Array.from(SOLANA_CONSTANTS.disabledHookRemainingAccountsHash),
    );
    expect(Array.from(instructionArgs.migratorInitRemainingAccountsHash!)).toEqual(
      Array.from(SOLANA_CONSTANTS.disabledHookRemainingAccountsHash),
    );
    expect(Array.from(instructionArgs.migratorRemainingAccountsHash!)).toEqual(
      Array.from(SOLANA_CONSTANTS.disabledHookRemainingAccountsHash),
    );
    expect(instructionArgs.hookPayload).toHaveLength(0);
    expect(instructionArgs.migratorInitPayload).toHaveLength(0);
    expect(instructionArgs.migratorMigratePayload).toHaveLength(0);
  });

  it('assembles CPMM Solana create instruction inputs for the SDK', async () => {
    const payer = await generateKeyPairSigner();
    const config = await generateKeyPairSigner();
    const launch = await generateKeyPairSigner();
    const launchAuthority = await generateKeyPairSigner();
    const launchFeeState = await generateKeyPairSigner();
    const baseMint = await generateKeyPairSigner();
    const baseVault = await generateKeyPairSigner();
    const quoteVault = await generateKeyPairSigner();
    const metadata = await generateKeyPairSigner();
    const cpmmMigrationState = await generateKeyPairSigner();
    const cpmmConfig = await generateKeyPairSigner();
    const migratorRemainingAccountsHash = new Uint8Array(32).fill(7);
    const migratorInitPayload = new Uint8Array([1, 2, 3]);
    const migratorMigratePayload = new Uint8Array([4, 5, 6]);
    const migrationAccounts = {
      cpmmMigrationState: cpmmMigrationState.address,
      cpmmConfig: cpmmConfig.address,
      hash: migratorRemainingAccountsHash,
    } as any;

    const [accounts, instructionArgs] = buildSolanaInitializeLaunchInstructionArgs({
      supportCpmmMigration: true,
      launchHookConfig: null,
      configAddress: config.address,
      launchAddress: launch.address,
      launchAuthorityAddress: launchAuthority.address,
      launchFeeStateAddress: launchFeeState.address,
      baseMint,
      quoteMint: SOLANA_CONSTANTS.wsolMintAddress,
      baseVault,
      quoteVault,
      metadataAddress: metadata.address,
      payer,
      namespace: payer.address,
      launchSeed: new Uint8Array(32).fill(3),
      totalSupply: 6_000_000_000n,
      baseForDistribution: 200_000_000n,
      baseForLiquidity: 300_000_000n,
      curveConfig: {
        curveVirtualBase: 999_000n,
        curveVirtualQuote: 111_000n,
      },
      swapFeeBps: 100,
      allowBuy: true,
      allowSell: true,
      migrationAccounts,
      migratorInitPayload,
      migratorMigratePayload,
      tokenMetadata: {
        name: 'CPMM Shape',
        symbol: 'CPMM',
        tokenURI: 'ipfs://cpmm-shape',
      },
      feeBeneficiaries: [],
    });

    expect(accounts).toMatchObject({
      hookProgram: SOLANA_CONSTANTS.cpmmHookProgramId,
      migratorProgram: SOLANA_CONSTANTS.cpmmMigratorProgramId,
      cpmmConfig: cpmmConfig.address,
      launchFeeState: launchFeeState.address,
    });
    expect(instructionArgs).toMatchObject({
      hookFlags: initializer.HF_BEFORE_SWAP,
      hookCreateRemainingAccountsLen: 0,
      baseForDistribution: 200_000_000n,
      baseForLiquidity: 300_000_000n,
      baseTotalSupply: 6_000_000_000n,
      swapFeeBps: 100,
      feeBeneficiaries: [],
    });
    expect(Array.from(instructionArgs.migratorInitPayload)).toEqual([1, 2, 3]);
    expect(Array.from(instructionArgs.migratorMigratePayload)).toEqual([4, 5, 6]);
    expect(Array.from(instructionArgs.migratorInitRemainingAccountsHash!)).toEqual(
      Array.from(
        initializer.computeRemainingAccountsHash([cpmmMigrationState.address, cpmmConfig.address]),
      ),
    );
    expect(Array.from(instructionArgs.migratorRemainingAccountsHash!)).toEqual(
      Array.from(migratorRemainingAccountsHash),
    );
    expect(Array.from(instructionArgs.hookCreateRemainingAccountsHash!)).toEqual(
      Array.from(SOLANA_CONSTANTS.disabledHookRemainingAccountsHash),
    );
    expect(Array.from(instructionArgs.hookRemainingAccountsHash!)).toEqual(
      Array.from(migratorRemainingAccountsHash),
    );
  });

  it('assembles Solana cosigning hook config for initializer SDK inputs', async () => {
    const cosigner = await generateKeyPairSigner();
    const hookConfig = await buildSolanaCosigningHookConfig({
      type: 'cosigner',
      cosigner: cosigner.address,
      expiry: {
        mode: 'slot',
        value: '123456',
      },
    });

    expect(hookConfig).not.toBeNull();
    expect(hookConfig!.hookProgram).toBe(SOLANA_CONSTANTS.cosignerHookProgramId);
    expect(hookConfig!.hookFlags).toBe(
      initializer.HF_BEFORE_SWAP | initializer.HF_FORWARD_READONLY_SIGNERS,
    );
    expect(hookConfig!.hookPayload).toHaveLength(42);
    expect(hookConfig!.hookRemainingAccounts).toHaveLength(2);
    expect(hookConfig!.hookRemainingAccounts[1]).toBe(cosigner.address);
    expect(Array.from(hookConfig!.hookRemainingAccountsHash)).toEqual(
      Array.from(initializer.computeRemainingAccountsHash(hookConfig!.hookRemainingAccounts)),
    );
  });

  it('assembles Solana dynamic fee hook config for initializer SDK inputs', async () => {
    const namespace = await generateKeyPairSigner();
    const hookConfig = await buildSolanaLaunchHookConfig({
      namespace: namespace.address,
      cosigningHook: undefined,
      dynamicFee: {
        startingTime: '0',
        startFeeBps: 8000,
        endFeeBps: 200,
        durationSeconds: '600',
      },
    });

    expect(hookConfig).not.toBeNull();
    expect(hookConfig!.hookProgram).toBe(SOLANA_CONSTANTS.dynamicFeeHookProgramId);
    expect(hookConfig!.hookFlags).toBe(initializer.HF_BEFORE_CREATE | initializer.HF_BEFORE_SWAP);
    expect(hookConfig!.hookPayload).toHaveLength(dynamicFeeHook.DYNAMIC_FEE_SCHEDULE_LEN);
    expect(dynamicFeeHook.isDynamicFeeSchedulePayload(hookConfig!.hookPayload)).toBe(true);
    expect(hookConfig!.hookCreateRemainingAccountsLen).toBe(0);
    expect(Array.from(hookConfig!.hookCreateRemainingAccountsHash)).toEqual(
      Array.from(initializer.computeRemainingAccountsHash([])),
    );
    expect(hookConfig!.hookRemainingAccounts).toEqual([namespace.address]);
    expect(Array.from(hookConfig!.hookRemainingAccountsHash)).toEqual(
      Array.from(initializer.computeRemainingAccountsHash([namespace.address])),
    );
  });

  it('preserves CPMM migration payloads when a dynamic fee hook is configured', async () => {
    const payer = await generateKeyPairSigner();
    const config = await generateKeyPairSigner();
    const launch = await generateKeyPairSigner();
    const launchAuthority = await generateKeyPairSigner();
    const launchFeeState = await generateKeyPairSigner();
    const baseMint = await generateKeyPairSigner();
    const baseVault = await generateKeyPairSigner();
    const quoteVault = await generateKeyPairSigner();
    const metadata = await generateKeyPairSigner();
    const cpmmMigrationState = await generateKeyPairSigner();
    const cpmmConfig = await generateKeyPairSigner();
    const cosigner = await generateKeyPairSigner();
    const migrationAccounts = {
      cpmmMigrationState: cpmmMigrationState.address,
      cpmmConfig: cpmmConfig.address,
      hash: new Uint8Array(32).fill(9),
    };
    const launchHookConfig = await buildSolanaLaunchHookConfig({
      namespace: payer.address,
      dynamicFee: {
        startingTime: '0',
        startFeeBps: 8000,
        endFeeBps: 200,
        durationSeconds: '600',
      },
      cosigningHook: {
        type: 'cosigner',
        cosigner: cosigner.address,
        expiry: {
          mode: 'unixTimestamp',
          value: '9999999999',
        },
      },
    });

    const [accounts, instructionArgs] = buildSolanaInitializeLaunchInstructionArgs({
      supportCpmmMigration: true,
      launchHookConfig,
      configAddress: config.address,
      launchAddress: launch.address,
      launchAuthorityAddress: launchAuthority.address,
      launchFeeStateAddress: launchFeeState.address,
      baseMint,
      quoteMint: SOLANA_CONSTANTS.wsolMintAddress,
      baseVault,
      quoteVault,
      metadataAddress: metadata.address,
      payer,
      namespace: payer.address,
      launchSeed: new Uint8Array(32).fill(5),
      totalSupply: 6_000_000_000n,
      baseForDistribution: 200_000_000n,
      baseForLiquidity: 300_000_000n,
      curveConfig: {
        curveVirtualBase: 999_000n,
        curveVirtualQuote: 111_000n,
      },
      swapFeeBps: 100,
      allowBuy: true,
      allowSell: true,
      migrationAccounts,
      migratorInitPayload: new Uint8Array([1, 2, 3]),
      migratorMigratePayload: new Uint8Array([4, 5, 6]),
      tokenMetadata: {
        name: 'Combined Hook',
        symbol: 'COMBO',
        tokenURI: 'ipfs://combined-hook',
      },
      feeBeneficiaries: [],
    });

    expect(accounts).toMatchObject({
      hookProgram: SOLANA_CONSTANTS.dynamicFeeHookProgramId,
      migratorProgram: SOLANA_CONSTANTS.cpmmMigratorProgramId,
      cpmmConfig: cpmmConfig.address,
    });
    expect(instructionArgs.hookFlags).toBe(
      initializer.HF_BEFORE_CREATE |
        initializer.HF_BEFORE_SWAP |
        initializer.HF_FORWARD_READONLY_SIGNERS,
    );
    expect(instructionArgs.hookPayload).toHaveLength(
      dynamicFeeHook.DYNAMIC_FEE_SCHEDULE_LEN + cosignerHook.GATE_EXPIRY_PAYLOAD_LEN,
    );
    expect(Array.from(instructionArgs.migratorInitPayload)).toEqual([1, 2, 3]);
    expect(Array.from(instructionArgs.migratorMigratePayload)).toEqual([4, 5, 6]);
    expect(Array.from(instructionArgs.migratorInitRemainingAccountsHash!)).toEqual(
      Array.from(
        initializer.computeRemainingAccountsHash([cpmmMigrationState.address, cpmmConfig.address]),
      ),
    );
    expect(Array.from(instructionArgs.migratorRemainingAccountsHash!)).toEqual(
      Array.from(migrationAccounts.hash),
    );
  });

  it('builds Solana CPMM migration payloads with the expected SDK encoder inputs', async () => {
    const payer = await generateKeyPairSigner();
    const cpmmMigrationState = await generateKeyPairSigner();
    const cpmmConfig = await generateKeyPairSigner();
    const migrationAccounts = {
      cpmmMigrationState: cpmmMigrationState.address,
      cpmmConfig: cpmmConfig.address,
      hash: new Uint8Array(32).fill(4),
    } as any;
    const encodeRegisterLaunchPayload = vi.fn().mockReturnValue(new Uint8Array([10, 11]));
    const encodeMigratePayload = vi.fn().mockReturnValue(new Uint8Array([12, 13]));

    const disabled = buildSolanaCpmmMigrationPayloads({
      supportCpmmMigration: false,
      migrationAccounts,
      payerAddress: payer.address,
      baseForDistribution: 200n,
      baseForLiquidity: 300n,
      minimumQuoteRaise: 400n,
      swapFeeBps: 75,
      feeBpsDenominator: SOLANA_CONSTANTS.feeBpsDenominator,
      encodeRegisterLaunchPayload,
      encodeMigratePayload,
    });
    expect(disabled.migrationRecipients).toEqual([]);
    expect(disabled.migratorInitPayload).toHaveLength(0);
    expect(disabled.migratorMigratePayload).toHaveLength(0);
    expect(encodeRegisterLaunchPayload).not.toHaveBeenCalled();
    expect(encodeMigratePayload).not.toHaveBeenCalled();

    const enabled = buildSolanaCpmmMigrationPayloads({
      supportCpmmMigration: true,
      migrationAccounts,
      payerAddress: payer.address,
      baseForDistribution: 200n,
      baseForLiquidity: 300n,
      minimumQuoteRaise: 400n,
      swapFeeBps: 75,
      feeBpsDenominator: SOLANA_CONSTANTS.feeBpsDenominator,
      encodeRegisterLaunchPayload,
      encodeMigratePayload,
    });

    expect(enabled.migrationRecipients).toEqual([{ wallet: payer.address, amount: 200n }]);
    expect(Array.from(enabled.migratorInitPayload)).toEqual([10, 11]);
    expect(Array.from(enabled.migratorMigratePayload)).toEqual([12, 13]);
    expect(encodeRegisterLaunchPayload).toHaveBeenCalledWith({
      cpmmConfig: cpmmConfig.address,
      initialSwapFeeBps: 75,
      initialFeeSplitBps: SOLANA_CONSTANTS.feeBpsDenominator,
      recipients: [{ wallet: payer.address, amount: 200n }],
      minRaiseQuote: 400n,
      minMigrationPriceQ64Opt: null,
      migratedPoolHookConfig: null,
    });
    expect(encodeMigratePayload).toHaveBeenCalledWith({
      baseForDistribution: 200n,
      baseForLiquidity: 300n,
    });
  });
});

describe('Solana transaction failure mapping helpers', () => {
  it('maps lookup-table submission and confirmation failures to stable errors', () => {
    expect(buildSolanaLookupTableSubmitError('rpc unavailable')).toMatchObject({
      statusCode: 502,
      code: 'SOLANA_SUBMISSION_FAILED',
      message: 'Failed to submit Solana lookup table setup transaction',
      details: { cause: 'rpc unavailable' },
    });
    expect(buildSolanaLookupTableConfirmTimeoutError()).toMatchObject({
      statusCode: 502,
      code: 'SOLANA_SUBMISSION_FAILED',
      message: 'Solana lookup table setup transaction did not confirm before timeout',
    });
    expect(buildSolanaLookupTableWarmupTimeoutError()).toMatchObject({
      statusCode: 502,
      code: 'SOLANA_SUBMISSION_FAILED',
      message: 'Solana lookup table setup did not warm up before timeout',
    });
    expect(() =>
      throwIfSolanaSignatureRejected(
        { err: { InstructionError: [0, 'Custom'] }, confirmationStatus: null },
        'Solana lookup table setup transaction was rejected after submission',
      ),
    ).toThrow(
      expect.objectContaining({
        statusCode: 502,
        code: 'SOLANA_SUBMISSION_FAILED',
        message: 'Solana lookup table setup transaction was rejected after submission',
      }),
    );
    expect(isSolanaSignatureConfirmed({ err: null, confirmationStatus: 'confirmed' })).toBe(true);
    expect(isSolanaSignatureConfirmed({ err: null, confirmationStatus: 'finalized' })).toBe(true);
    expect(isSolanaSignatureConfirmed({ err: null, confirmationStatus: 'processed' })).toBe(false);
  });

  it('maps simulation RPC and program errors to stable details', () => {
    expect(buildSolanaSimulationRpcError('node refused simulation')).toMatchObject({
      statusCode: 502,
      code: 'SOLANA_SIMULATION_FAILED',
      message: 'Failed to simulate Solana launch transaction',
      details: { cause: 'node refused simulation' },
    });

    const parsedProgramError = buildSolanaSimulationProgramError(
      ['Program log: custom error'],
      () =>
        ({
          code: 123,
          codeName: 'BadCurve',
          message: 'Bad curve parameters',
          name: 'BadCurve',
        }) as any,
    );

    expect(parsedProgramError).toMatchObject({
      statusCode: 422,
      code: 'SOLANA_SIMULATION_FAILED',
      message: 'Bad curve parameters',
      details: {
        programError: {
          code: 123,
          codeName: 'BadCurve',
          message: 'Bad curve parameters',
        },
        logs: ['Program log: custom error'],
      },
    });
    expect(buildSolanaSimulationProgramError(['raw log'], () => null)).toMatchObject({
      statusCode: 422,
      code: 'SOLANA_SIMULATION_FAILED',
      message: 'Solana launch simulation failed',
      details: { logs: ['raw log'] },
    });
  });

  it('maps launch confirmation timeouts and lookup failures to idempotency doubt', async () => {
    const launch = await generateKeyPairSigner();
    const details = {
      launchId: launch.address,
      signature:
        '5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J',
      explorerUrl:
        'https://explorer.solana.com/tx/5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J?cluster=devnet',
    };

    expect(buildSolanaLaunchConfirmationTimeoutError(details)).toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_IN_DOUBT',
      message: 'Solana launch submission completed but confirmation did not resolve before timeout',
      details,
    });
    expect(buildSolanaLaunchConfirmationLookupError(details)).toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_IN_DOUBT',
      message: 'Solana launch submission completed but confirmation could not be verified',
      details,
    });
  });
});
