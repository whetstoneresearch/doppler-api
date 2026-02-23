import { airlockAbi, type BeneficiaryData } from '@whetstone-research/doppler-sdk';

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
import type { DopplerSdkRegistry } from '../../../infra/doppler/sdk-client';
import type { TxSubmitter } from '../../../infra/tx/submitter';
import { resolveGovernance } from '../../governance/policy';
import { resolveMigration } from '../../migration/policy';
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
    return STATIC_MARKET_CAP_PRESETS[input.preset];
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

  const { totalSupply, tokensForSale } = resolveSaleNumbers(input);
  const allocationPlan = resolveAllocationPlan({
    input,
    totalSupply,
    tokensForSale,
  });

  const governance = resolveGovernance(input.governance, chain.config);
  const migration = resolveMigration(input.migration, chain.config);
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
      marketCap: marketCapRange,
      numerairePrice: numerairePriceUsd,
      ...(staticCurve.fee !== undefined ? { fee: staticCurve.fee } : {}),
      ...(staticCurve.numPositions !== undefined ? { numPositions: staticCurve.numPositions } : {}),
      ...(maxShareToBeSold !== undefined ? { maxShareToBeSold } : {}),
    })
    .withBeneficiaries(beneficiaries as BeneficiaryData[]);

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

  const params = builder
    .withGovernance(governance)
    .withMigration(migration)
    .withUserAddress(input.userAddress as HexAddress)
    .build();

  const simulation = await sdk.factory.simulateCreateStaticAuction(params as any);

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
