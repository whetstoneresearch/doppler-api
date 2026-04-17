import { airlockAbi, type MigrationConfig } from '@whetstone-research/doppler-sdk/evm';
import { parseUnits } from 'viem';

import { AppError } from '../../../core/errors';
import type { CreateLaunchResponse, HexAddress, HexHash } from '../../../core/types';
import type { ChainContext } from '../../../infra/chain/registry';
import type { DopplerSdkRegistry } from '../../../infra/doppler/sdk-client';
import type { TxSubmitter } from '../../../infra/tx/submitter';
import type { CreateDynamicLaunchRequestInput } from '../../launches/schema';
import { buildLaunchId } from '../../launches/mapper';
import { resolveGovernance } from '../../governance/policy';
import { resolveDynamicMigration } from '../../migration/policy';
import type { PricingService } from '../../pricing/service';
import {
  normalizeFeeBeneficiaries,
  resolveAllocationPlan,
  resolveSaleNumbers,
} from '../multicurve/mapper';

interface CreateDynamicArgs {
  input: CreateDynamicLaunchRequestInput;
  chain: ChainContext;
  sdkRegistry: DopplerSdkRegistry;
  pricingService: PricingService;
  txSubmitter: TxSubmitter;
}

const DEFAULT_V4_STREAMABLE_FEES_LOCK_DURATION_SECONDS = 90 * 24 * 60 * 60;

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
  const sdk = sdkRegistry.get(chain.chainId);

  const { totalSupply, tokensForSale } = resolveSaleNumbers(input);
  const allocationPlan = resolveAllocationPlan({
    input,
    totalSupply,
    tokensForSale,
  });

  const governance = resolveGovernance(input.governance, chain.config);
  const migration = resolveDynamicMigration(input.migration, chain.config);
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
      name: input.tokenMetadata.name,
      symbol: input.tokenMetadata.symbol,
      tokenURI: input.tokenMetadata.tokenURI,
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

  const migrationConfig: MigrationConfig =
    migration.type === 'uniswapV4'
      ? {
          ...migration,
          streamableFees: {
            lockDuration: DEFAULT_V4_STREAMABLE_FEES_LOCK_DURATION_SECONDS,
            beneficiaries,
          },
        }
      : migration;

  const params = builder
    .withGovernance(governance)
    .withMigration(migrationConfig)
    .withUserAddress(input.userAddress as HexAddress)
    .build();

  const simulation = await sdk.factory.simulateCreateDynamicAuction(params as any);

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
    },
  };
};
