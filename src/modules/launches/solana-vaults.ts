import { generateKeyPairSigner, type Address } from '@solana/kit';
import { initializer } from '@whetstone-research/doppler-sdk/solana';

import { AppError } from '../../core/errors';

type LegacyBuilder = typeof initializer.createInitializeLaunchInstruction;
type VaultSdk = Pick<typeof initializer, 'createInitializeLaunchInstruction'> & {
  getBaseVaultAddress?: typeof initializer.getLaunchAuthorityAddress;
  getQuoteVaultAddress?: typeof initializer.getLaunchAuthorityAddress;
  createInitializeLaunchV2Instruction?: (
    accounts: Omit<Parameters<LegacyBuilder>[0], 'baseVault' | 'quoteVault'> & {
      baseVault: Address;
      quoteVault: Address;
    },
    args: Parameters<LegacyBuilder>[1],
  ) => ReturnType<LegacyBuilder>;
};

// Keep the existing SDK usable until the V2 SDK release and program upgrade are deployed.
export async function prepareSolanaLaunchVaults(
  launch: Address,
  deterministic: boolean,
  sdk: VaultSdk = initializer,
) {
  if (!deterministic) {
    const [baseVault, quoteVault] = await Promise.all([
      generateKeyPairSigner(),
      generateKeyPairSigner(),
    ]);
    return {
      baseVault,
      quoteVault,
      baseVaultAddress: baseVault.address,
      quoteVaultAddress: quoteVault.address,
      buildInstruction: sdk.createInitializeLaunchInstruction,
    };
  }
  const { getBaseVaultAddress, getQuoteVaultAddress, createInitializeLaunchV2Instruction } = sdk;
  if (!getBaseVaultAddress || !getQuoteVaultAddress || !createInitializeLaunchV2Instruction) {
    throw new AppError(
      503,
      'SOLANA_NOT_READY',
      'Deterministic vaults require an SDK release with initialize_launch_v2 support; update the SDK before enabling SOLANA_DETERMINISTIC_VAULTS',
    );
  }
  const [[baseVault], [quoteVault]] = await Promise.all([
    getBaseVaultAddress(launch),
    getQuoteVaultAddress(launch),
  ]);
  return {
    baseVault,
    quoteVault,
    baseVaultAddress: baseVault,
    quoteVaultAddress: quoteVault,
    buildInstruction: (
      accounts: Parameters<LegacyBuilder>[0],
      args: Parameters<LegacyBuilder>[1],
    ) => createInitializeLaunchV2Instruction({ ...accounts, baseVault, quoteVault }, args),
  };
}
