import { describe, expect, it, vi } from 'vitest';
import {
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
} from '@solana/kit';
import { initializer } from '@whetstone-research/doppler-sdk/solana';
import { prepareSolanaLaunchVaults } from '../../src/modules/launches/solana-vaults';

const derive =
  (seed: string) => (launch: Parameters<typeof initializer.getLaunchAuthorityAddress>[0]) =>
    getProgramDerivedAddress({
      programAddress: initializer.INITIALIZER_PROGRAM_ID,
      seeds: [new TextEncoder().encode(seed), getAddressEncoder().encode(launch)],
    });

describe('Solana launch vault rollout', () => {
  it('retains vault signers and the legacy builder when disabled', async () => {
    const launch = (await generateKeyPairSigner()).address;
    const prepared = await prepareSolanaLaunchVaults(launch, false);
    expect(prepared.baseVault).toHaveProperty('signTransactions');
    expect(prepared.quoteVault).toHaveProperty('signTransactions');
    expect(prepared.baseVaultAddress).not.toBe(prepared.quoteVaultAddress);
    expect(prepared.buildInstruction).toBe(initializer.createInitializeLaunchInstruction);
  });

  it('fails closed when the installed SDK does not support V2', async () => {
    const launch = (await generateKeyPairSigner()).address;
    await expect(
      prepareSolanaLaunchVaults(launch, true, {
        createInitializeLaunchInstruction: initializer.createInitializeLaunchInstruction,
      }),
    ).rejects.toMatchObject({ code: 'SOLANA_NOT_READY' });
  });

  it('derives vaults once and forwards them to the V2 builder without signers', async () => {
    const payer = await generateKeyPairSigner();
    const baseMint = await generateKeyPairSigner();
    const launchId = initializer.launchIdFromU64(42n);
    const [launch] = await initializer.getLaunchAddress(payer.address, launchId);
    const [config] = await initializer.getConfigAddress();
    const [launchAuthority] = await initializer.getLaunchAuthorityAddress(launch);
    const buildV2 = vi
      .fn()
      .mockResolvedValue({ programAddress: initializer.INITIALIZER_PROGRAM_ID });
    const prepared = await prepareSolanaLaunchVaults(launch, true, {
      createInitializeLaunchInstruction: initializer.createInitializeLaunchInstruction,
      createInitializeLaunchV2Instruction: buildV2,
      getBaseVaultAddress: derive('base_vault'),
      getQuoteVaultAddress: derive('quote_vault'),
    });
    expect(prepared.baseVault).toBe((await derive('base_vault')(launch))[0]);
    expect(prepared.quoteVault).toBe((await derive('quote_vault')(launch))[0]);
    const accounts = {
      config,
      launch,
      launchAuthority,
      baseMint,
      payer,
      baseVault: prepared.baseVault,
      quoteVault: prepared.quoteVault,
      quoteMint: address('So11111111111111111111111111111111111111112'),
      rent: address('SysvarRent111111111111111111111111111111111'),
    };
    const args = {
      namespace: payer.address,
      launchId,
      baseDecimals: 6,
      baseTotalSupply: 1_000_000n,
      baseForDistribution: 0n,
      baseForLiquidity: 0n,
      curveVirtualBase: 1_000_000n,
      curveVirtualQuote: 100_000n,
      curveKind: 0,
      curveParams: new Uint8Array([0]),
      allowBuy: true,
      allowSell: true,
      swapFeeBps: 200,
      hookFlags: 0,
      hookPayload: new Uint8Array(),
      migratorInitPayload: new Uint8Array(),
      migratorMigratePayload: new Uint8Array(),
      hookRemainingAccountsHash: new Uint8Array(32),
      migratorInitRemainingAccountsHash: new Uint8Array(32),
      migratorRemainingAccountsHash: new Uint8Array(32),
      metadataName: '',
      metadataSymbol: '',
      metadataUri: '',
    };
    await prepared.buildInstruction(accounts, args);
    expect(buildV2).toHaveBeenCalledWith(accounts, args);
  });
});
