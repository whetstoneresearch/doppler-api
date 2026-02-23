import { AppError } from '../../core/errors';
import type { ChainRuntimeConfig } from '../../core/config';
import type { AuctionType } from '../../core/types';

export const ensureAuctionSupported = (
  auctionType: AuctionType,
  chainConfig: ChainRuntimeConfig,
): void => {
  if (!chainConfig.auctionTypes.includes(auctionType)) {
    throw new AppError(
      422,
      'AUCTION_TYPE_UNSUPPORTED',
      `Auction type ${auctionType} is not enabled for chain ${chainConfig.chainId}`,
    );
  }
};
