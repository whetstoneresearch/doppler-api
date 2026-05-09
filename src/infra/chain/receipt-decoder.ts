import { airlockAbi } from '@whetstone-research/doppler-sdk/evm';
import { decodeEventLog, type Hex } from 'viem';

import type { HexAddress } from '../../core/types';

export interface DecodedCreateEvent {
  tokenAddress: HexAddress;
  poolOrHookAddress: HexAddress;
}

export const decodeCreateEvent = (logs: readonly unknown[]): DecodedCreateEvent | null => {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: airlockAbi,
        data: (log as { data: Hex }).data,
        topics: (log as { topics: readonly Hex[] }).topics as [Hex, ...Hex[]],
      });

      if (decoded.eventName === 'Create') {
        const args = decoded.args as { asset?: HexAddress; poolOrHook?: HexAddress };
        if (args.asset && args.poolOrHook) {
          return { tokenAddress: args.asset, poolOrHookAddress: args.poolOrHook };
        }
      }
    } catch {
      // ignore non-airlock logs
    }
  }

  return null;
};
