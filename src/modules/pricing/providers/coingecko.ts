import { AppError } from '../../../core/errors';
import type { PriceProvider, PriceRequest } from '../provider';

interface CoingeckoConfig {
  baseUrl: string;
  timeoutMs: number;
  apiKey?: string;
  defaultAssetId: string;
}

export class CoingeckoPriceProvider implements PriceProvider {
  readonly name = 'coingecko';
  private readonly config: CoingeckoConfig;

  constructor(config: CoingeckoConfig) {
    this.config = config;
  }

  private async fetchUsdPriceForAssetId(assetId: string): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const url = new URL('/simple/price', this.config.baseUrl);
    url.searchParams.set('ids', assetId);
    url.searchParams.set('vs_currencies', 'usd');

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          ...(this.config.apiKey ? { 'x-cg-demo-api-key': this.config.apiKey } : {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError(
          502,
          'PRICE_UPSTREAM_ERROR',
          `Price provider returned ${response.status}`,
        );
      }

      const data = (await response.json()) as Record<string, { usd?: number }>;
      const usd = data[assetId]?.usd;
      if (!usd || !Number.isFinite(usd) || usd <= 0) {
        throw new AppError(
          502,
          'PRICE_UPSTREAM_INVALID',
          'Price provider returned an invalid USD value',
        );
      }

      return usd;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'PRICE_FETCH_FAILED', 'Unable to fetch numeraire price', error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getUsdPrice(request: PriceRequest): Promise<number> {
    if (!request.defaultNumeraireAddress) {
      throw new AppError(
        422,
        'PRICE_UNSUPPORTED_NUMERAIRE',
        `No default numeraire configured for chain ${request.chainId}; explicit pricing.numerairePriceUsd is required`,
      );
    }

    if (request.numeraireAddress.toLowerCase() !== request.defaultNumeraireAddress.toLowerCase()) {
      throw new AppError(
        422,
        'PRICE_UNSUPPORTED_NUMERAIRE',
        `Auto pricing currently supports only the default numeraire for chain ${request.chainId}; provide pricing.numerairePriceUsd override`,
      );
    }

    return this.fetchUsdPriceForAssetId(this.config.defaultAssetId);
  }

  async getUsdPriceByAssetId(assetId: string): Promise<number> {
    return this.fetchUsdPriceForAssetId(assetId);
  }
}
