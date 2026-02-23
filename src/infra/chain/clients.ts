import type { ChainContext } from './registry';

export const createChainClientMap = (contexts: ChainContext[]) => {
  const map = new Map<number, ChainContext>();
  for (const context of contexts) {
    map.set(context.chainId, context);
  }
  return map;
};
