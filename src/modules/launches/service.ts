import { AppError } from '../../core/errors';
import type { CreateLaunchResponse } from '../../core/types';
import type { ChainRegistry } from '../../infra/chain/registry';
import type { DopplerSdkRegistry } from '../../infra/doppler/sdk-client';
import type { IdempotencyStore } from '../../infra/idempotency/store';
import type { TxSubmitter } from '../../infra/tx/submitter';
import type { PricingService } from '../pricing/service';
import { ensureAuctionSupported } from './policies';
import type {
  CreateLaunchRequestInput,
  CreateMulticurveLaunchRequestInput,
  CreateStaticLaunchRequestInput,
} from './schema';
import { createMulticurveLaunch } from '../auctions/multicurve/service';
import { createStaticLaunch } from '../auctions/static/service';

interface LaunchServiceDeps {
  chainRegistry: ChainRegistry;
  sdkRegistry: DopplerSdkRegistry;
  pricingService: PricingService;
  txSubmitter: TxSubmitter;
  idempotencyStore: IdempotencyStore;
  requireIdempotencyKey: boolean;
}

export class LaunchService {
  private readonly chainRegistry: ChainRegistry;
  private readonly sdkRegistry: DopplerSdkRegistry;
  private readonly pricingService: PricingService;
  private readonly txSubmitter: TxSubmitter;
  private readonly idempotencyStore: IdempotencyStore;
  private readonly requireIdempotencyKey: boolean;

  constructor(deps: LaunchServiceDeps) {
    this.chainRegistry = deps.chainRegistry;
    this.sdkRegistry = deps.sdkRegistry;
    this.pricingService = deps.pricingService;
    this.txSubmitter = deps.txSubmitter;
    this.idempotencyStore = deps.idempotencyStore;
    this.requireIdempotencyKey = deps.requireIdempotencyKey;
  }

  private async createLaunchInternal(
    input: CreateLaunchRequestInput,
  ): Promise<CreateLaunchResponse> {
    const chain = this.chainRegistry.get(input.chainId);

    if (input.auction.type === 'dynamic') {
      throw new AppError(
        501,
        'AUCTION_NOT_IMPLEMENTED',
        'dynamic launches are not implemented yet and are coming soon',
      );
    }

    ensureAuctionSupported(input.auction.type, chain.config);

    if (input.auction.type === 'multicurve') {
      return createMulticurveLaunch({
        input: input as CreateMulticurveLaunchRequestInput,
        chain,
        sdkRegistry: this.sdkRegistry,
        pricingService: this.pricingService,
        txSubmitter: this.txSubmitter,
      });
    }

    if (input.auction.type === 'static') {
      return createStaticLaunch({
        input: input as CreateStaticLaunchRequestInput,
        chain,
        sdkRegistry: this.sdkRegistry,
        pricingService: this.pricingService,
        txSubmitter: this.txSubmitter,
      });
    }

    throw new AppError(
      422,
      'AUCTION_TYPE_UNSUPPORTED',
      `Unsupported auction type: ${(input.auction as { type: string }).type}`,
    );
  }

  async createLaunch(input: CreateLaunchRequestInput): Promise<CreateLaunchResponse> {
    return this.createLaunchInternal(input);
  }

  async createLaunchWithIdempotency(args: {
    input: CreateLaunchRequestInput;
    idempotencyKey?: string;
  }): Promise<{ response: CreateLaunchResponse; replayed: boolean }> {
    const key = args.idempotencyKey?.trim();
    if (this.requireIdempotencyKey && !key) {
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key header is required for create launch requests',
      );
    }

    if (!key) {
      const response = await this.createLaunchInternal(args.input);
      return { response, replayed: false };
    }

    return this.idempotencyStore.execute(key, args.input, () =>
      this.createLaunchInternal(args.input),
    );
  }
}
