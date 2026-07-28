import { airlockAbi, type BeneficiaryData } from '@whetstone-research/doppler-sdk/evm';

import { AppError } from '../../../core/errors';
import type {
  CreateLaunchResponse,
  HexAddress,
  HexHash,
  MarketCapPreset,
} from '../../../core/types';
import type { PricingService } from '../../pricing/service';
import type { CreateStaticLaunchRequestInput } from '../../launches/schema';
import type { ChainContext } from '../../../infra/chain/registry';
import {
  type DopplerSdkRegistry,
  withCreateSimulationErrorTranslation,
} from '../../../infra/doppler/sdk-client';
import type { TxSubmitter } from '../../../infra/tx/submitter';
import { resolveGovernance } from '../../governance/policy';
import {
  normalizeFeeBeneficiaries,
  parsePositiveBigInt,
  resolveAllocationPlan,
  resolveSaleNumbers,
} from '../multicurve/mapper';
import { buildLaunchId, poolOrHookAddressToPoolId } from '../../launches/mapper';

interface CreateStaticArgs {
  input: CreateStaticLaunchRequestInput;
  chain: ChainContext;
  sdkRegistry: DopplerSdkRegistry;
  pricingService: PricingService;
  txSubmitter: TxSubmitter;
}

export const STATIC_MARKET_CAP_PRESETS: Record<MarketCapPreset, { start: number; end: number }> = {
  low: { start: 7_500, end: 30_000 },
  medium: { start: 50_000, end: 150_000 },
  high: { start: 250_000, end: 750_000 },
};

const resolveStaticMarketCapRange = (
  input: CreateStaticLaunchRequestInput['auction']['curveConfig'],
): { start: number; end: number } => {
  if (input.type === 'preset') {
    switch (input.preset) {
      case 'low':
        return STATIC_MARKET_CAP_PRESETS.low;
      case 'medium':
        return STATIC_MARKET_CAP_PRESETS.medium;
      case 'high':
        return STATIC_MARKET_CAP_PRESETS.high;
      default:
        throw new AppError(
          422,
          'INVALID_MARKET_CAP_PRESET',
          'Unsupported static market-cap preset',
        );
    }
  }

  return {
    start: input.marketCapStartUsd,
    end: input.marketCapEndUsd,
  };
};

export const createStaticLaunch = async ({
  input,
  chain,
  sdkRegistry,
  pricingService,
  txSubmitter,
}: CreateStaticArgs): Promise<CreateLaunchResponse> => {
  const sdk = sdkRegistry.get(chain.chainId);
  const lockableV3Initializer = chain.addresses.lockableV3Initializer;
  if (!lockableV3Initializer) {
    throw new AppError(
      422,
      'LOCKABLE_V3_INITIALIZER_UNSUPPORTED',
      `Lockable V3 initializer is not configured for chain ${chain.chainId}`,
    );
  }

  const { totalSupply, tokensForSale } = resolveSaleNumbers(input);
  const allocationPlan = resolveAllocationPlan({
    input,
    totalSupply,
    tokensForSale,
  });

  const governance = resolveGovernance(input.governance, chain.config);
  const protocolOwner = (await sdk.getAirlockOwner()) as HexAddress;

  const numeraireAddress =
    (input.pairing?.numeraireAddress as HexAddress | undefined) ??
    chain.config.defaultNumeraireAddress ??
    (chain.addresses.weth as HexAddress | undefined);

  if (!numeraireAddress) {
    throw new AppError(
      422,
      'NUMERAIRE_REQUIRED',
      `No default numeraire configured for chain ${chain.chainId}`,
    );
  }

  const numerairePriceUsd = await pricingService.resolveNumerairePriceUsd({
    chainId: chain.chainId,
    numeraireAddress,
    defaultNumeraireAddress:
      chain.config.defaultNumeraireAddress ?? (chain.addresses.weth as HexAddress | undefined),
    overrideUsd: input.pricing?.numerairePriceUsd,
  });

  const { beneficiaries, source } = await normalizeFeeBeneficiaries({
    input,
    protocolOwner,
  });

  const staticCurve = input.auction.curveConfig;
  const marketCapRange = resolveStaticMarketCapRange(staticCurve);
  const maxShareToBeSold =
    staticCurve.maxShareToBeSoldWad === undefined
      ? undefined
      : parsePositiveBigInt(
          staticCurve.maxShareToBeSoldWad,
          'auction.curveConfig.maxShareToBeSoldWad',
        );

  const builder = sdk
    .buildStaticAuction()
    .tokenConfig({
      type: 'dopplerERC20V1',
      name: input.tokenMetadata.name,
      symbol: input.tokenMetadata.symbol,
      tokenURI: input.tokenMetadata.tokenURI,
      ...(input.tokenMetadata.maxBalanceLimit === undefined
        ? {}
        : {
            maxBalanceLimit: BigInt(input.tokenMetadata.maxBalanceLimit),
          }),
      ...(input.tokenMetadata.balanceLimitEnd === undefined
        ? {}
        : { balanceLimitEnd: input.tokenMetadata.balanceLimitEnd }),
      ...(input.tokenMetadata.controller === undefined
        ? {}
        : { controller: input.tokenMetadata.controller }),
      ...(input.tokenMetadata.excludedFromBalanceLimit === undefined
        ? {}
        : { excludedFromBalanceLimit: input.tokenMetadata.excludedFromBalanceLimit }),
    })
    .saleConfig({
      initialSupply: totalSupply,
      numTokensToSell: tokensForSale,
      numeraire: numeraireAddress,
    })
    .withMarketCapRange({
      marketCap: marketCapRange,
      numerairePrice: numerairePriceUsd,
      ...(staticCurve.fee !== undefined ? { fee: staticCurve.fee } : {}),
      ...(staticCurve.numPositions !== undefined ? { numPositions: staticCurve.numPositions } : {}),
      ...(maxShareToBeSold !== undefined ? { maxShareToBeSold } : {}),
    })
    .withBeneficiaries(beneficiaries as BeneficiaryData[])
    .withV3Initializer(lockableV3Initializer);

  if (input.integrationAddress) {
    builder.withIntegrator(input.integrationAddress as HexAddress);
  }

  if (allocationPlan.allocationAmount > 0n) {
    builder.withVesting({
      allocations: allocationPlan.allocations.map((allocation) => ({
        recipient: allocation.recipient,
        amount: allocation.amount,
        schedule: {
          duration: BigInt(allocation.durationSeconds),
          cliffDuration: allocation.cliffDurationSeconds,
        },
      })),
    });
  }

  const params = builder
    .withGovernance(governance)
    .withMigration({ type: 'noOp' })
    .withUserAddress(input.userAddress as HexAddress)
    .build();

  const simulation = await sdk.factory.simulateCreateStaticAuction(params);

  const simulationRequest = {
    address: chain.addresses.airlock,
    abi: airlockAbi,
    functionName: 'create',
    args: [{ ...simulation.createParams }],
    account: chain.walletClient.account,
    blockTag: 'pending',
  } as const;
  const { request } = await withCreateSimulationErrorTranslation(chain, simulationRequest, () =>
    chain.publicClient.simulateContract(simulationRequest),
  );

  const txHash = (await txSubmitter.submitCreateTx({
    chain,
    request: request as Record<string, unknown>,
    gasEstimate: simulation.gasEstimate,
  })) as HexHash;

  const launchId = buildLaunchId(chain.chainId, txHash);
  const predictedPoolId = poolOrHookAddressToPoolId(simulation.pool as HexAddress);

  return {
    launchId,
    chainId: chain.chainId,
    txHash,
    statusUrl: `/v1/launches/${launchId}`,
    predicted: {
      tokenAddress: simulation.asset as HexAddress,
      poolId: predictedPoolId,
      ...(simulation.gasEstimate ? { gasEstimate: simulation.gasEstimate.toString() } : {}),
    },
    effectiveConfig: {
      tokensForSale: tokensForSale.toString(),
      allocationAmount: allocationPlan.allocationAmount.toString(),
      vestingAllocations: allocationPlan.allocations.map((allocation) => ({
        recipientAddress: allocation.recipient,
        amount: allocation.amount.toString(),
        durationSeconds: allocation.durationSeconds,
        cliffDurationSeconds: allocation.cliffDurationSeconds,
      })),
      numeraireAddress,
      numerairePriceUsd,
      poolFeeBeneficiariesSource: source,
    },
  };
};
