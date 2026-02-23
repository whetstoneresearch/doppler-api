import type { HexAddress, HexHash } from '../../core/types';

export const buildLaunchId = (chainId: number, txHash: HexHash): string => `${chainId}:${txHash}`;

export const parseLaunchId = (launchId: string): { chainId: number; txHash: HexHash } => {
  const [chainIdStr, txHash] = launchId.split(':');
  const chainId = Number(chainIdStr);
  if (!Number.isInteger(chainId) || chainId <= 0 || !/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) {
    throw new Error('Invalid launchId');
  }
  return { chainId, txHash: txHash as HexHash };
};

export const poolOrHookAddressToPoolId = (address: HexAddress): HexHash =>
  `0x${address.slice(2).padStart(64, '0')}` as HexHash;
