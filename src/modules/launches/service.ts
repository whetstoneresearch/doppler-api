import { AppError } from '../../core/errors';
import type { CreateAnyLaunchResponse, CreateLaunchResponse } from '../../core/types';
import type { ChainRegistry } from '../../infra/chain/registry';
import type { DopplerSdkRegistry } from '../../infra/doppler/sdk-client';
import type { IdempotencyStore } from '../../infra/idempotency/store';
import type { TxSubmitter } from '../../infra/tx/submitter';
import type { PricingService } from '../pricing/service';
import { ensureAuctionSupported } from './policies';
import type {
  CreateDynamicLaunchRequestInput,
  CreateLaunchRequestInput,
  CreateMulticurveLaunchRequestInput,
  CreateStaticLaunchRequestInput,
} from './schema';
import { createDynamicLaunch } from '../auctions/dynamic/service';
import { createMulticurveLaunch } from '../auctions/multicurve/service';
import { createStaticLaunch } from '../auctions/static/service';
import { SolanaLaunchService, type CreateSolanaLaunchRequestInput } from './solana';

interface LaunchServiceDeps {
  chainRegistry: ChainRegistry;
  sdkRegistry: DopplerSdkRegistry;
  pricingService: PricingService;
  txSubmitter: TxSubmitter;
  idempotencyStore: IdempotencyStore;
  requireIdempotencyKey: boolean;
  solanaLaunchService: SolanaLaunchService;
}

export class LaunchService {
  private readonly chainRegistry: ChainRegistry;
  private readonly sdkRegistry: DopplerSdkRegistry;
  private readonly pricingService: PricingService;
  private readonly txSubmitter: TxSubmitter;
  private readonly idempotencyStore: IdempotencyStore;
  private readonly requireIdempotencyKey: boolean;
  private readonly solanaLaunchService: SolanaLaunchService;

  constructor(deps: LaunchServiceDeps) {
    this.chainRegistry = deps.chainRegistry;
    this.sdkRegistry = deps.sdkRegistry;
    this.pricingService = deps.pricingService;
    this.txSubmitter = deps.txSubmitter;
    this.idempotencyStore = deps.idempotencyStore;
    this.requireIdempotencyKey = deps.requireIdempotencyKey;
    this.solanaLaunchService = deps.solanaLaunchService;
  }

  private async createLaunchInternal(
    input: CreateLaunchRequestInput | CreateSolanaLaunchRequestInput,
    idempotencyKey?: string,
  ): Promise<CreateAnyLaunchResponse> {
    if ('network' in input) {
      return this.solanaLaunchService.createLaunch(input, idempotencyKey);
    }

    const chain = this.chainRegistry.get(input.chainId);

    ensureAuctionSupported(input.auction.type, chain.config);

    if (input.auction.type === 'dynamic') {
      return createDynamicLaunch({
        input: input as CreateDynamicLaunchRequestInput,
        chain,
        sdkRegistry: this.sdkRegistry,
        pricingService: this.pricingService,
        txSubmitter: this.txSubmitter,
      });
    }

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
    return this.createLaunchInternal(input) as Promise<CreateLaunchResponse>;
  }

  async createLaunchWithIdempotency(args: {
    input: CreateLaunchRequestInput | CreateSolanaLaunchRequestInput;
    idempotencyKey?: string;
  }): Promise<{ response: CreateAnyLaunchResponse; replayed: boolean }> {
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
      this.createLaunchInternal(args.input, key),
    );
  }
}
