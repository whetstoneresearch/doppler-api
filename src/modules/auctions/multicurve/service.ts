// allow: SIZE_OK — multicurve launch assembly remains one transaction boundary.
import { airlockAbi, type BeneficiaryData } from '@whetstone-research/doppler-sdk/evm';

import { AppError } from '../../../core/errors';
import type {
  CreateLaunchResponse,
  HexAddress,
  HexHash,
  RangesCurveInput,
} from '../../../core/types';
import type { PricingService } from '../../pricing/service';
import type { CreateMulticurveLaunchRequestInput } from '../../launches/schema';
import type { ChainContext } from '../../../infra/chain/registry';
import {
  type DopplerSdkRegistry,
  withCreateSimulationErrorTranslation,
} from '../../../infra/doppler/sdk-client';
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

const requireModuleAddress = (address: HexAddress | undefined, moduleName: string): HexAddress => {
  if (!address) {
    throw new AppError(
      500,
      'UNSUPPORTED_CHAIN',
      `Doppler SDK is missing ${moduleName} for this chain`,
    );
  }

  return address;
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
  const governance = resolveGovernance(input.governance, chain.config);
  const migration = resolveMigration();

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
      type: 'dopplerERC20V1',
      name: input.tokenMetadata.name,
      symbol: input.tokenMetadata.symbol,
      tokenURI: input.tokenMetadata.tokenURI,
      ...(input.tokenMetadata.maxBalanceLimit === undefined
        ? {}
        : {
            maxBalanceLimit: parseNonNegativeBigInt(
              input.tokenMetadata.maxBalanceLimit,
              'tokenMetadata.maxBalanceLimit',
            ),
          }),
      ...(input.tokenMetadata.balanceLimitEnd === undefined
        ? {}
        : { balanceLimitEnd: input.tokenMetadata.balanceLimitEnd }),
      ...(input.tokenMetadata.balanceController === undefined
        ? {}
        : { controller: input.tokenMetadata.balanceController }),
      ...(input.tokenMetadata.excludedFromBalanceLimit === undefined
        ? {}
        : { excludedFromBalanceLimit: input.tokenMetadata.excludedFromBalanceLimit }),
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

    const ranges = input.auction.curveConfig.curves.map((curve: RangesCurveInput) => ({
      marketCap: {
        start: curve.marketCapStartUsd,
        end: curve.marketCapEndUsd,
      },
      numPositions: curve.numPositions,
      shares: parsePositiveBigInt(curve.sharesWad, 'auction.curveConfig.curves[].sharesWad'),
    }));

    builder.withCurves({
      numerairePrice: numerairePriceUsd,
      fee: input.auction.curveConfig.fee,
      tickSpacing,
      curves: ranges,
      beneficiaries,
    });
  }

  const initializer = input.auction.initializer;
  const rehypeDestination = (() => {
    if ('rehypeFeeBeneficiaries' in initializer) {
      const [firstBeneficiary, ...remainingBeneficiaries] = initializer.rehypeFeeBeneficiaries;
      const mapBeneficiary = (beneficiary: typeof firstBeneficiary) => ({
        beneficiary: beneficiary.address,
        shares: parsePositiveBigInt(
          beneficiary.sharesWad,
          `auction.initializer.rehypeFeeBeneficiaries[${beneficiary.address}].sharesWad`,
        ),
      });
      const feeBeneficiaries: [BeneficiaryData, ...BeneficiaryData[]] = [
        mapBeneficiary(firstBeneficiary),
        ...remainingBeneficiaries.map(mapBeneficiary),
      ];
      return { feeBeneficiaries };
    }
    return { buybackDestination: initializer.buybackDestination };
  })();
  builder.withRehypeDopplerHookInitializer({
    hookAddress: requireModuleAddress(
      chain.addresses.rehypeDopplerHookInitializer,
      'rehypeDopplerHookInitializer',
    ),
    ...rehypeDestination,
    startFee: initializer.startFee,
    ...(initializer.endFee === undefined ? {} : { endFee: initializer.endFee }),
    ...(initializer.durationSeconds === undefined
      ? {}
      : { durationSeconds: initializer.durationSeconds }),
    ...(initializer.startingTime === undefined ? {} : { startingTime: initializer.startingTime }),
    feeDistributionInfo: {
      assetFeesToAssetBuybackWad: parseNonNegativeBigInt(
        initializer.feeDistributionInfo.assetFeesToAssetBuybackWad,
        'auction.initializer.feeDistributionInfo.assetFeesToAssetBuybackWad',
      ),
      assetFeesToNumeraireBuybackWad: parseNonNegativeBigInt(
        initializer.feeDistributionInfo.assetFeesToNumeraireBuybackWad,
        'auction.initializer.feeDistributionInfo.assetFeesToNumeraireBuybackWad',
      ),
      assetFeesToBeneficiaryWad: parseNonNegativeBigInt(
        initializer.feeDistributionInfo.assetFeesToBeneficiaryWad,
        'auction.initializer.feeDistributionInfo.assetFeesToBeneficiaryWad',
      ),
      assetFeesToLpWad: parseNonNegativeBigInt(
        initializer.feeDistributionInfo.assetFeesToLpWad,
        'auction.initializer.feeDistributionInfo.assetFeesToLpWad',
      ),
      numeraireFeesToAssetBuybackWad: parseNonNegativeBigInt(
        initializer.feeDistributionInfo.numeraireFeesToAssetBuybackWad,
        'auction.initializer.feeDistributionInfo.numeraireFeesToAssetBuybackWad',
      ),
      numeraireFeesToNumeraireBuybackWad: parseNonNegativeBigInt(
        initializer.feeDistributionInfo.numeraireFeesToNumeraireBuybackWad,
        'auction.initializer.feeDistributionInfo.numeraireFeesToNumeraireBuybackWad',
      ),
      numeraireFeesToBeneficiaryWad: parseNonNegativeBigInt(
        initializer.feeDistributionInfo.numeraireFeesToBeneficiaryWad,
        'auction.initializer.feeDistributionInfo.numeraireFeesToBeneficiaryWad',
      ),
      numeraireFeesToLpWad: parseNonNegativeBigInt(
        initializer.feeDistributionInfo.numeraireFeesToLpWad,
        'auction.initializer.feeDistributionInfo.numeraireFeesToLpWad',
      ),
    },
  });
  builder.withDopplerHookInitializer(
    requireModuleAddress(chain.addresses.dopplerHookInitializer, 'dopplerHookInitializer'),
  );

  const params = builder
    .withGovernance(governance)
    .withMigration(migration)
    .withUserAddress(input.userAddress as HexAddress)
    .build();

  const simulation = await sdk.factory.simulateCreateMulticurve(params);

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
  const gasEstimate = typeof request.gas === 'bigint' ? request.gas : simulation.gasEstimate;

  const txHash = (await txSubmitter.submitCreateTx({
    chain,
    request: request as Record<string, unknown>,
    gasEstimate,
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
      ...(gasEstimate ? { gasEstimate: gasEstimate.toString() } : {}),
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
      initializer,
    },
  };
};
