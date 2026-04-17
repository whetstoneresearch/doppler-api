import {
  airlockAbi,
  type MigrationConfig,
  type GovernanceOption,
  type BeneficiaryData,
} from '@whetstone-research/doppler-sdk/evm';

import { AppError } from '../../../core/errors';
import type { CreateLaunchResponse, HexAddress, HexHash } from '../../../core/types';
import type { PricingService } from '../../pricing/service';
import type { CreateMulticurveLaunchRequestInput } from '../../launches/schema';
import type { ChainContext } from '../../../infra/chain/registry';
import type { DopplerSdkRegistry } from '../../../infra/doppler/sdk-client';
import type { TxSubmitter } from '../../../infra/tx/submitter';
import { resolveGovernance } from '../../governance/policy';
import { resolveMigration } from '../../migration/policy';
import {
  normalizeFeeBeneficiaries,
  parsePositiveBigInt,
  resolveAllocationPlan,
  resolveSaleNumbers,
} from './mapper';
import { buildLaunchId } from '../../launches/mapper';
import { resolvePresetTickSpacing, resolveRangesTickSpacing } from './tick-spacing';

interface CreateMulticurveArgs {
  input: CreateMulticurveLaunchRequestInput;
  chain: ChainContext;
  sdkRegistry: DopplerSdkRegistry;
  pricingService: PricingService;
  txSubmitter: TxSubmitter;
}

const parseNonNegativeBigInt = (value: string, field: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch (error) {
    throw new AppError(422, 'INVALID_BIGINT', `${field} must be a valid bigint string`, error);
  }

  if (parsed < 0n) {
    throw new AppError(422, 'INVALID_BIGINT', `${field} must be >= 0`);
  }

  return parsed;
};

export const createMulticurveLaunch = async ({
  input,
  chain,
  sdkRegistry,
  pricingService,
  txSubmitter,
}: CreateMulticurveArgs): Promise<CreateLaunchResponse> => {
  const sdk = sdkRegistry.get(chain.chainId);

  const { totalSupply, tokensForSale } = resolveSaleNumbers(input);
  const allocationPlan = resolveAllocationPlan({
    input,
    totalSupply,
    tokensForSale,
  });

  // Resolve policy-gated controls first so planned modes fail fast with 501
  // without requiring any RPC calls.
  const governance = resolveGovernance(input.governance, chain.config) as GovernanceOption<any>;
  const migration = resolveMigration(input.migration, chain.config) as MigrationConfig;

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

  const builder = sdk
    .buildMulticurveAuction()
    .tokenConfig({
      name: input.tokenMetadata.name,
      symbol: input.tokenMetadata.symbol,
      tokenURI: input.tokenMetadata.tokenURI,
    })
    .saleConfig({
      initialSupply: totalSupply,
      numTokensToSell: tokensForSale,
      numeraire: numeraireAddress,
    });

  if (input.integrationAddress) {
    builder.withIntegrator(input.integrationAddress as HexAddress);
  }

  if (allocationPlan.allocationAmount > 0n) {
    builder.withVesting({
      duration: BigInt(allocationPlan.lockDurationSeconds),
      cliffDuration: allocationPlan.cliffDurationSeconds,
      recipients: allocationPlan.recipients,
      amounts: allocationPlan.amounts,
    });
  }

  if (input.auction.curveConfig.type === 'preset') {
    const tickSpacing = resolvePresetTickSpacing({
      fee: input.auction.curveConfig.fee,
      tickSpacing: input.auction.curveConfig.tickSpacing,
      presets: input.auction.curveConfig.presets,
    });

    builder.withMarketCapPresets({
      presets: input.auction.curveConfig.presets,
      fee: input.auction.curveConfig.fee,
      tickSpacing,
      beneficiaries,
    });
  } else {
    const tickSpacing = resolveRangesTickSpacing({
      fee: input.auction.curveConfig.fee,
      tickSpacing: input.auction.curveConfig.tickSpacing,
    });

    const ranges = input.auction.curveConfig.curves.map((curve) => ({
      marketCap: {
        start: curve.marketCapStartUsd,
        // keep raw request semantics and let the SDK perform validation / conversions
        end: curve.marketCapEndUsd as unknown as number,
      },
      numPositions: curve.numPositions,
      shares: parsePositiveBigInt(curve.sharesWad, 'auction.curveConfig.curves[].sharesWad'),
    }));

    builder.withCurves({
      numerairePrice: numerairePriceUsd,
      fee: input.auction.curveConfig.fee,
      tickSpacing,
      curves: ranges,
      beneficiaries: beneficiaries as BeneficiaryData[],
    });
  }

  const requestedInitializer = input.auction.initializer ?? { type: 'standard' as const };
  if (requestedInitializer.type === 'standard') {
    // Standard mode is implemented via scheduled initializer with startTime=0.
    builder.withSchedule({ startTime: 0 });
  } else if (requestedInitializer.type === 'scheduled') {
    builder.withSchedule({ startTime: requestedInitializer.startTime });
  } else if (requestedInitializer.type === 'decay') {
    builder.withDecay({
      startTime: requestedInitializer.startTime,
      startFee: requestedInitializer.startFee,
      durationSeconds: requestedInitializer.durationSeconds,
    });
  } else {
    builder.withRehypeDopplerHook({
      hookAddress: requestedInitializer.config.hookAddress as HexAddress,
      buybackDestination: requestedInitializer.config.buybackDestination as HexAddress,
      customFee: requestedInitializer.config.customFee,
      assetBuybackPercentWad: parseNonNegativeBigInt(
        requestedInitializer.config.assetBuybackPercentWad,
        'auction.initializer.config.assetBuybackPercentWad',
      ),
      numeraireBuybackPercentWad: parseNonNegativeBigInt(
        requestedInitializer.config.numeraireBuybackPercentWad,
        'auction.initializer.config.numeraireBuybackPercentWad',
      ),
      beneficiaryPercentWad: parseNonNegativeBigInt(
        requestedInitializer.config.beneficiaryPercentWad,
        'auction.initializer.config.beneficiaryPercentWad',
      ),
      lpPercentWad: parseNonNegativeBigInt(
        requestedInitializer.config.lpPercentWad,
        'auction.initializer.config.lpPercentWad',
      ),
      graduationCalldata: requestedInitializer.config.graduationCalldata as
        | `0x${string}`
        | undefined,
      graduationMarketCap: requestedInitializer.config.graduationMarketCap,
      numerairePrice: requestedInitializer.config.numerairePrice,
      farTick: requestedInitializer.config.farTick,
    });
  }

  const params = builder
    .withGovernance(governance)
    .withMigration(migration)
    .withUserAddress(input.userAddress as HexAddress)
    .build();

  const effectiveInitializer =
    requestedInitializer.type === 'standard'
      ? ({ type: 'standard' } as const)
      : requestedInitializer.type === 'scheduled'
        ? ({ type: 'scheduled', startTime: requestedInitializer.startTime } as const)
        : requestedInitializer.type === 'decay'
          ? ({
              type: 'decay',
              startTime: requestedInitializer.startTime ?? 0,
              startFee: requestedInitializer.startFee,
              endFee: Number((params as { pool: { fee: number } }).pool.fee),
              durationSeconds: requestedInitializer.durationSeconds,
            } as const)
          : ({ type: 'rehype' } as const);

  const simulation = await sdk.factory.simulateCreateMulticurve(params as any);

  const { request } = await chain.publicClient.simulateContract({
    address: chain.addresses.airlock,
    abi: airlockAbi,
    functionName: 'create',
    args: [{ ...simulation.createParams }],
    account: chain.walletClient.account,
  });

  const txHash = (await txSubmitter.submitCreateTx({
    chain,
    request: request as Record<string, unknown>,
    gasEstimate: simulation.gasEstimate,
  })) as HexHash;

  const launchId = buildLaunchId(chain.chainId, txHash);

  return {
    launchId,
    chainId: chain.chainId,
    txHash,
    statusUrl: `/v1/launches/${launchId}`,
    predicted: {
      tokenAddress: simulation.tokenAddress as HexAddress,
      poolId: simulation.poolId as HexHash,
      ...(simulation.gasEstimate ? { gasEstimate: simulation.gasEstimate.toString() } : {}),
    },
    effectiveConfig: {
      tokensForSale: tokensForSale.toString(),
      allocationAmount: allocationPlan.allocationAmount.toString(),
      allocationRecipient: allocationPlan.recipientAddress,
      allocationRecipients: allocationPlan.recipients.map((address, index) => ({
        address,
        amount: allocationPlan.amounts[index]!.toString(),
      })),
      allocationLockMode: allocationPlan.lockMode,
      allocationLockDurationSeconds: allocationPlan.lockDurationSeconds,
      numeraireAddress,
      numerairePriceUsd,
      feeBeneficiariesSource: source,
      initializer: effectiveInitializer,
    },
  };
};
