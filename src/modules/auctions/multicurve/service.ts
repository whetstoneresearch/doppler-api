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

const normalizeHexData = (value: string): `0x${string}` => `0x${value.slice(2)}`;

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

  const requestedInitializer = input.auction.initializer ?? { type: 'standard' as const };
  if (requestedInitializer.type === 'rehype') {
    const config = requestedInitializer.config;
    const rehypeDestination = (() => {
      if ('rehypeFeeBeneficiaries' in config) {
        const [firstBeneficiary, ...remainingBeneficiaries] = config.rehypeFeeBeneficiaries;
        const mapBeneficiary = (beneficiary: typeof firstBeneficiary) => ({
          beneficiary: beneficiary.address,
          shares: parsePositiveBigInt(
            beneficiary.sharesWad,
            `auction.initializer.config.rehypeFeeBeneficiaries[${beneficiary.address}].sharesWad`,
          ),
        });
        const feeBeneficiaries: [BeneficiaryData, ...BeneficiaryData[]] = [
          mapBeneficiary(firstBeneficiary),
          ...remainingBeneficiaries.map((beneficiary) => ({
            beneficiary: beneficiary.address,
            shares: parsePositiveBigInt(
              beneficiary.sharesWad,
              `auction.initializer.config.rehypeFeeBeneficiaries[${beneficiary.address}].sharesWad`,
            ),
          })),
        ];
        return { feeBeneficiaries };
      }
      return { buybackDestination: config.buybackDestination };
    })();
    builder.withRehypeDopplerHookInitializer({
      hookAddress: requireModuleAddress(
        chain.addresses.rehypeDopplerHookInitializer,
        'rehypeDopplerHookInitializer',
      ),
      ...rehypeDestination,
      startFee: config.startFee,
      ...(config.endFee === undefined ? {} : { endFee: config.endFee }),
      ...(config.durationSeconds === undefined ? {} : { durationSeconds: config.durationSeconds }),
      ...(config.startingTime === undefined ? {} : { startingTime: config.startingTime }),
      feeDistributionInfo: {
        assetFeesToAssetBuybackWad: parseNonNegativeBigInt(
          config.feeDistributionInfo.assetFeesToAssetBuybackWad,
          'auction.initializer.config.feeDistributionInfo.assetFeesToAssetBuybackWad',
        ),
        assetFeesToNumeraireBuybackWad: parseNonNegativeBigInt(
          config.feeDistributionInfo.assetFeesToNumeraireBuybackWad,
          'auction.initializer.config.feeDistributionInfo.assetFeesToNumeraireBuybackWad',
        ),
        assetFeesToBeneficiaryWad: parseNonNegativeBigInt(
          config.feeDistributionInfo.assetFeesToBeneficiaryWad,
          'auction.initializer.config.feeDistributionInfo.assetFeesToBeneficiaryWad',
        ),
        assetFeesToLpWad: parseNonNegativeBigInt(
          config.feeDistributionInfo.assetFeesToLpWad,
          'auction.initializer.config.feeDistributionInfo.assetFeesToLpWad',
        ),
        numeraireFeesToAssetBuybackWad: parseNonNegativeBigInt(
          config.feeDistributionInfo.numeraireFeesToAssetBuybackWad,
          'auction.initializer.config.feeDistributionInfo.numeraireFeesToAssetBuybackWad',
        ),
        numeraireFeesToNumeraireBuybackWad: parseNonNegativeBigInt(
          config.feeDistributionInfo.numeraireFeesToNumeraireBuybackWad,
          'auction.initializer.config.feeDistributionInfo.numeraireFeesToNumeraireBuybackWad',
        ),
        numeraireFeesToBeneficiaryWad: parseNonNegativeBigInt(
          config.feeDistributionInfo.numeraireFeesToBeneficiaryWad,
          'auction.initializer.config.feeDistributionInfo.numeraireFeesToBeneficiaryWad',
        ),
        numeraireFeesToLpWad: parseNonNegativeBigInt(
          config.feeDistributionInfo.numeraireFeesToLpWad,
          'auction.initializer.config.feeDistributionInfo.numeraireFeesToLpWad',
        ),
      },
      ...(config.graduationCalldata === undefined
        ? {}
        : { graduationCalldata: normalizeHexData(config.graduationCalldata) }),
      ...(config.graduationMarketCap === undefined
        ? {}
        : { graduationMarketCap: config.graduationMarketCap }),
      ...(config.numerairePrice === undefined ? {} : { numerairePrice: config.numerairePrice }),
      ...(config.farTick === undefined ? {} : { farTick: config.farTick }),
    });
  }
  builder.withDopplerHookInitializer(
    requireModuleAddress(chain.addresses.dopplerHookInitializer, 'dopplerHookInitializer'),
  );

  const params = builder
    .withGovernance(governance)
    .withMigration(migration)
    .withUserAddress(input.userAddress as HexAddress)
    .build();

  const effectiveInitializer =
    requestedInitializer.type === 'standard'
      ? ({ type: 'standard' } as const)
      : ({ type: 'rehype' } as const);

  const simulation = await sdk.factory.simulateCreateMulticurve(params);

  const { request } = await chain.publicClient.simulateContract({
    address: chain.addresses.airlock,
    abi: airlockAbi,
    functionName: 'create',
    args: [{ ...simulation.createParams }],
    account: chain.walletClient.account,
  });
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
      initializer: effectiveInitializer,
    },
  };
};
