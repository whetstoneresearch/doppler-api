import { AppError } from '../../core/errors';
import type { AppConfig } from '../../core/config';
import type { HexAddress } from '../../core/types';
import type { PriceProvider } from './provider';
import { CoingeckoPriceProvider } from './providers/coingecko';

interface ResolvePriceArgs {
  chainId: number;
  numeraireAddress: HexAddress;
  defaultNumeraireAddress?: HexAddress;
  overrideUsd?: number;
}

interface CachedPrice {
  value: number;
  expiresAt: number;
}

export class PricingService {
  private readonly enabled: boolean;
  private readonly provider: PriceProvider | null;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CachedPrice>();

  constructor(config: AppConfig) {
    this.enabled = config.pricing.enabled;
    this.cacheTtlMs = config.pricing.cacheTtlMs;

    if (!this.enabled || config.pricing.provider === 'none') {
      this.provider = null;
      return;
    }

    this.provider = new CoingeckoPriceProvider({
      baseUrl: config.pricing.baseUrl,
      timeoutMs: config.pricing.timeoutMs,
      apiKey: config.pricing.apiKey,
      defaultAssetId: config.pricing.coingeckoAssetId,
    });
  }

  getProviderName(): string {
    return this.provider?.name ?? 'none';
  }

  isEnabled(): boolean {
    return this.enabled && this.provider !== null;
  }

  async resolveNumerairePriceUsd(args: ResolvePriceArgs): Promise<number> {
    if (args.overrideUsd !== undefined) {
      if (!Number.isFinite(args.overrideUsd) || args.overrideUsd <= 0) {
        throw new AppError(
          422,
          'INVALID_PRICE_OVERRIDE',
          'pricing.numerairePriceUsd must be a positive number',
        );
      }
      return args.overrideUsd;
    }

    if (!this.provider) {
      throw new AppError(
        422,
        'PRICE_REQUIRED',
        'Auto pricing is disabled or unavailable; provide pricing.numerairePriceUsd in the request',
      );
    }

    const cacheKey = `${args.chainId}:${args.numeraireAddress.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await this.provider.getUsdPrice({
      chainId: args.chainId,
      numeraireAddress: args.numeraireAddress,
      defaultNumeraireAddress: args.defaultNumeraireAddress,
    });

    this.cache.set(cacheKey, { value, expiresAt: now + this.cacheTtlMs });
    return value;
  }
}
