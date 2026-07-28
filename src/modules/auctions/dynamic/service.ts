import { airlockAbi } from '@whetstone-research/doppler-sdk/evm';
import { parseUnits } from 'viem';

import { AppError } from '../../../core/errors';
import type { CreateLaunchResponse, HexHash } from '../../../core/types';
import type { ChainContext } from '../../../infra/chain/registry';
import {
  type DopplerSdkRegistry,
  withCreateSimulationErrorTranslation,
} from '../../../infra/doppler/sdk-client';
import type { CreateDynamicLaunchRequestInput } from '../../launches/schema';
import { buildLaunchId } from '../../launches/mapper';
import { resolveGovernance } from '../../governance/policy';
import { resolveRequestedMigration } from '../../migration/policy';
import type { PricingService } from '../../pricing/service';
import {
  normalizeFeeBeneficiaries,
  resolveAllocationPlan,
  resolveSaleNumbers,
} from '../multicurve/mapper';

type DynamicChainContext = Pick<ChainContext, 'chainId' | 'config' | 'addresses'> & {
  publicClient: Pick<ChainContext['publicClient'], 'getBytecode' | 'simulateContract'>;
  walletClient: Pick<ChainContext['walletClient'], 'account'>;
};

interface DynamicTxSubmitter {
  submitCreateTx(args: {
    chain: DynamicChainContext;
    request: Record<string, unknown>;
    gasEstimate?: bigint;
  }): Promise<HexHash>;
}

interface CreateDynamicArgs {
  input: CreateDynamicLaunchRequestInput;
  chain: DynamicChainContext;
  sdkRegistry: Pick<DopplerSdkRegistry, 'get'>;
  pricingService: Pick<PricingService, 'resolveNumerairePriceUsd'>;
  txSubmitter: DynamicTxSubmitter;
}

const parseProceedsUnits = (value: string, field: string): bigint => {
  try {
    return parseUnits(value, 18);
  } catch (error) {
    throw new AppError(
      422,
      'INVALID_REQUEST',
      `${field} must be a valid decimal string with up to 18 decimals`,
      error,
    );
  }
};

export const createDynamicLaunch = async ({
  input,
  chain,
  sdkRegistry,
  pricingService,
  txSubmitter,
}: CreateDynamicArgs): Promise<CreateLaunchResponse> => {
  if (input.migration.type === 'uniswapV2' && input.poolFeeBeneficiaries !== undefined) {
    throw new AppError(
      422,
      'INVALID_REQUEST',
      'poolFeeBeneficiaries is not supported with migration.type="uniswapV2"',
    );
  }

  const sdk = sdkRegistry.get(chain.chainId);

  const { totalSupply, tokensForSale } = resolveSaleNumbers(input);
  const allocationPlan = resolveAllocationPlan({
    input,
    totalSupply,
    tokensForSale,
  });

  const governance = resolveGovernance(input.governance, chain.config);

  const numeraireAddress =
    input.pairing?.numeraireAddress ?? chain.config.defaultNumeraireAddress ?? chain.addresses.weth;

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
    defaultNumeraireAddress: chain.config.defaultNumeraireAddress ?? chain.addresses.weth,
    overrideUsd: input.pricing?.numerairePriceUsd,
  });

  const { beneficiaries, source } =
    input.migration.type === 'uniswapV2'
      ? { beneficiaries: [], source: 'none' as const }
      : await normalizeFeeBeneficiaries({
          input,
          protocolOwner: await sdk.getAirlockOwner(),
        });
  const migration = resolveRequestedMigration({
    migration: input.migration,
    chainConfig: chain.config,
    beneficiaries,
  });

  const dynamicCurve = input.auction.curveConfig;
  const minProceeds = parseProceedsUnits(
    dynamicCurve.minProceeds,
    'auction.curveConfig.minProceeds',
  );
  const maxProceeds = parseProceedsUnits(
    dynamicCurve.maxProceeds,
    'auction.curveConfig.maxProceeds',
  );
  if (minProceeds < 0n) {
    throw new AppError(422, 'INVALID_REQUEST', 'auction.curveConfig.minProceeds must be >= 0');
  }
  if (maxProceeds <= 0n) {
    throw new AppError(422, 'INVALID_REQUEST', 'auction.curveConfig.maxProceeds must be > 0');
  }
  if (minProceeds > maxProceeds) {
    throw new AppError(
      422,
      'INVALID_REQUEST',
      'auction.curveConfig.minProceeds cannot exceed auction.curveConfig.maxProceeds',
    );
  }

  const builder = sdk
    .buildDynamicAuction()
    .tokenConfig({
      type: 'dopplerERC20V1',
      name: input.tokenMetadata.name,
      symbol: input.tokenMetadata.symbol,
      tokenURI: input.tokenMetadata.tokenURI,
      ...(input.tokenMetadata.maxBalanceLimit !== undefined
        ? { maxBalanceLimit: BigInt(input.tokenMetadata.maxBalanceLimit) }
        : {}),
      ...(input.tokenMetadata.balanceLimitEnd !== undefined
        ? { balanceLimitEnd: input.tokenMetadata.balanceLimitEnd }
        : {}),
      ...(input.tokenMetadata.controller !== undefined
        ? { controller: input.tokenMetadata.controller }
        : {}),
      ...(input.tokenMetadata.excludedFromBalanceLimit !== undefined
        ? { excludedFromBalanceLimit: input.tokenMetadata.excludedFromBalanceLimit }
        : {}),
    })
    .saleConfig({
      initialSupply: totalSupply,
      numTokensToSell: tokensForSale,
      numeraire: numeraireAddress,
    })
    .withMarketCapRange({
      marketCap: {
        start: dynamicCurve.marketCapStartUsd,
        min: dynamicCurve.marketCapMinUsd,
      },
      numerairePrice: numerairePriceUsd,
      minProceeds,
      maxProceeds,
      ...(dynamicCurve.fee !== undefined ? { fee: dynamicCurve.fee } : {}),
      ...(dynamicCurve.tickSpacing !== undefined ? { tickSpacing: dynamicCurve.tickSpacing } : {}),
      ...(dynamicCurve.durationSeconds !== undefined
        ? { duration: dynamicCurve.durationSeconds }
        : {}),
      ...(dynamicCurve.epochLengthSeconds !== undefined
        ? { epochLength: dynamicCurve.epochLengthSeconds }
        : {}),
      ...(dynamicCurve.gamma !== undefined ? { gamma: dynamicCurve.gamma } : {}),
      ...(dynamicCurve.numPdSlugs !== undefined ? { numPdSlugs: dynamicCurve.numPdSlugs } : {}),
    })
    .withV4Initializer(chain.addresses.v4Initializer);

  if (input.integrationAddress) {
    builder.withIntegrator(input.integrationAddress);
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

  if (migration.type === 'uniswapV2Split') {
    const v2MigratorSplit = chain.addresses.v2MigratorSplit;
    if (!v2MigratorSplit) {
      throw new AppError(
        500,
        'UNSUPPORTED_CHAIN',
        `Doppler SDK is missing v2MigratorSplit for chain ${chain.chainId}`,
      );
    }
    builder.withV2MigratorSplit(v2MigratorSplit);
  } else if (migration.type === 'dopplerHook') {
    const dopplerHookMigrator = chain.addresses.dopplerHookMigrator;
    if (!dopplerHookMigrator) {
      throw new AppError(
        500,
        'UNSUPPORTED_CHAIN',
        `Doppler SDK is missing dopplerHookMigrator for chain ${chain.chainId}`,
      );
    }
    builder.withDopplerHookMigrator(dopplerHookMigrator);
    if (migration.rehype) {
      const rehypeDopplerHookMigrator = chain.addresses.rehypeDopplerHookMigrator;
      if (!rehypeDopplerHookMigrator) {
        throw new AppError(
          500,
          'UNSUPPORTED_CHAIN',
          `Doppler SDK is missing rehypeDopplerHookMigrator for chain ${chain.chainId}`,
        );
      }
      builder.withRehypeDopplerHookMigrator(rehypeDopplerHookMigrator);
    }
  }

  const params = builder
    .withGovernance(governance)
    .withMigration(migration)
    .withUserAddress(input.userAddress)
    .build();

  const simulation = await sdk.factory.simulateCreateDynamicAuction(params);

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

  const txHash = await txSubmitter.submitCreateTx({
    chain,
    request,
    gasEstimate: simulation.gasEstimate,
  });
  const launchId = buildLaunchId(chain.chainId, txHash);

  return {
    launchId,
    chainId: chain.chainId,
    txHash,
    statusUrl: `/v1/launches/${launchId}`,
    predicted: {
      tokenAddress: simulation.tokenAddress,
      poolId: simulation.poolId as HexHash,
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
