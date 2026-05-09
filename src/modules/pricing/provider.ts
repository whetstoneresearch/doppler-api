import type { HexAddress } from '../../core/types';

export interface PriceRequest {
  chainId: number;
  numeraireAddress: HexAddress;
  defaultNumeraireAddress?: HexAddress;
}

export interface PriceProvider {
  readonly name: string;
  getUsdPrice(request: PriceRequest): Promise<number>;
  getUsdPriceByAssetId?(assetId: string): Promise<number>;
}
