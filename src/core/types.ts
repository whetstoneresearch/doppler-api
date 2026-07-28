// allow: SIZE_OK — shared public and persisted API contracts remain colocated for compatibility.
export type HexAddress = `0x${string}`;
export type HexHash = `0x${string}`;
export type SolanaNetwork = 'solanaDevnet' | 'solanaMainnetBeta';

export type GovernanceMode = 'noOp' | 'default' | 'custom';
export type MigrationType = 'noOp' | 'uniswapV2' | 'uniswapV4';
export type AuctionType = 'multicurve' | 'static' | 'dynamic';

export interface TokenMetadata {
  name: string;
  symbol: string;
  tokenURI: string;
  maxBalanceLimit?: string;
  balanceLimitEnd?: number;
  balanceController?: HexAddress;
  excludedFromBalanceLimit?: HexAddress[];
}

export interface Economics {
  totalSupply: string;
  tokensForSale?: string;
  allocations?: Array<{
    recipientAddress: HexAddress;
    amount: string;
    durationSeconds: number;
    cliffDurationSeconds?: number;
  }>;
}

export interface PairingConfig {
  numeraireAddress?: HexAddress;
}

export interface PricingConfig {
  numerairePriceUsd?: number;
}

export interface PoolFeeBeneficiaryInput {
  address: HexAddress;
  sharesWad: string;
}

export interface RehypeFeeBeneficiaryInput {
  address: HexAddress;
  sharesWad: string;
}

export interface RehypeFeeDistributionInfoInput {
  assetFeesToAssetBuybackWad: string;
  assetFeesToNumeraireBuybackWad: string;
  assetFeesToBeneficiaryWad: string;
  assetFeesToLpWad: string;
  numeraireFeesToAssetBuybackWad: string;
  numeraireFeesToNumeraireBuybackWad: string;
  numeraireFeesToBeneficiaryWad: string;
  numeraireFeesToLpWad: string;
}

export type MigrationConfigInput =
  | {
      type: 'uniswapV2';
      feeBeneficiary?: {
        address: HexAddress;
        percentage: number;
      };
    }
  | {
      type: 'uniswapV4';
      fee: number;
      tickSpacing: number;
      lockDurationSeconds: number;
      rehype?: {
        buybackDestination: HexAddress;
        customFee: number;
        feeRoutingMode?: 'directBuyback' | 'routeToBeneficiaryFees';
        feeDistributionInfo: RehypeFeeDistributionInfoInput;
      };
    };

export interface PresetCurveConfig {
  type: 'preset';
  presets?: Array<'low' | 'medium' | 'high'>;
  fee?: number;
  tickSpacing?: number;
}

export interface RangesCurveInput {
  marketCapStartUsd: number;
  marketCapEndUsd: number | 'max';
  numPositions: number;
  sharesWad: string;
}

export interface RangesCurveConfig {
  type: 'ranges';
  fee?: number;
  tickSpacing?: number;
  curves: RangesCurveInput[];
}

export type CurveConfig = PresetCurveConfig | RangesCurveConfig;

export type MarketCapPreset = 'low' | 'medium' | 'high';

export interface StaticPresetCurveConfig {
  type: 'preset';
  preset: MarketCapPreset;
  fee?: number;
  numPositions?: number;
  maxShareToBeSoldWad?: string;
}

export interface StaticRangeCurveConfig {
  type: 'range';
  marketCapStartUsd: number;
  marketCapEndUsd: number;
  fee?: number;
  numPositions?: number;
  maxShareToBeSoldWad?: string;
}

export type StaticCurveConfig = StaticPresetCurveConfig | StaticRangeCurveConfig;

export type MulticurveInitializerConfig = {
  startFee: number;
  endFee?: number;
  durationSeconds?: number;
  startingTime?: number;
  feeDistributionInfo: RehypeFeeDistributionInfoInput;
} & (
  | {
      buybackDestination: HexAddress;
      rehypeFeeBeneficiaries?: never;
    }
  | {
      buybackDestination?: never;
      rehypeFeeBeneficiaries: [RehypeFeeBeneficiaryInput, ...RehypeFeeBeneficiaryInput[]];
    }
);

export interface MulticurveAuctionConfig {
  type: 'multicurve';
  curveConfig: CurveConfig;
  initializer: MulticurveInitializerConfig;
}

export interface StaticAuctionConfig {
  type: 'static';
  curveConfig: StaticCurveConfig;
}

export interface DynamicAuctionConfig {
  type: 'dynamic';
  curveConfig: DynamicCurveConfig;
}

export type AuctionConfig = MulticurveAuctionConfig | StaticAuctionConfig | DynamicAuctionConfig;

export interface DynamicRangeCurveConfig {
  type: 'range';
  marketCapStartUsd: number;
  marketCapMinUsd: number;
  minProceeds: string;
  maxProceeds: string;
  durationSeconds?: number;
  epochLengthSeconds?: number;
  fee?: number;
  tickSpacing?: number;
  gamma?: number;
  numPdSlugs?: number;
}

export type DynamicCurveConfig = DynamicRangeCurveConfig;

interface CreateLaunchRequestBase {
  chainId?: number;
  userAddress: HexAddress;
  integrationAddress?: HexAddress;
  tokenMetadata: TokenMetadata;
  economics: Economics;
  pairing?: PairingConfig;
  pricing?: PricingConfig;
  poolFeeBeneficiaries?: PoolFeeBeneficiaryInput[];
  governance?: boolean | HexAddress;
}

export type CreateLaunchRequest =
  | (CreateLaunchRequestBase & {
      migration?: never;
      auction: StaticAuctionConfig;
    })
  | (CreateLaunchRequestBase & {
      migration?: never;
      auction: MulticurveAuctionConfig;
    })
  | (CreateLaunchRequestBase & {
      migration: MigrationConfigInput;
      auction: DynamicAuctionConfig;
    });

export interface CreateLaunchPredicted {
  tokenAddress: HexAddress;
  poolId: HexHash;
  gasEstimate?: string;
}

export interface EffectiveLaunchConfig {
  tokensForSale: string;
  allocationAmount: string;
  vestingAllocations: Array<{
    recipientAddress: HexAddress;
    amount: string;
    durationSeconds: number;
    cliffDurationSeconds: number;
  }>;
  numeraireAddress: HexAddress;
  numerairePriceUsd: number;
  poolFeeBeneficiariesSource: 'default' | 'request' | 'none';
  initializer?: MulticurveInitializerConfig;
}

export interface CreateLaunchResponse {
  launchId: string;
  chainId: number;
  txHash: HexHash;
  statusUrl: string;
  predicted: CreateLaunchPredicted;
  effectiveConfig: EffectiveLaunchConfig;
}

export interface CreateSolanaLaunchPredicted {
  tokenAddress: string;
  launchAuthorityAddress: string;
  launchFeeStateAddress: string;
  baseVaultAddress: string;
  quoteVaultAddress: string;
}

export interface SolanaFeeBeneficiaryEffective {
  address: string;
  shareBps: number;
}

export interface SolanaEffectiveLaunchConfig {
  tokensForSale: string;
  allocationAmount: string;
  baseForDistribution: string;
  baseForLiquidity: string;
  allocationLockMode: 'none';
  numeraireAddress: string;
  numerairePriceUsd: number;
  curveVirtualBase: string;
  curveVirtualQuote: string;
  curveFeeBps: number;
  swapFeeBps: number;
  feeBeneficiariesSource: 'default' | 'request';
  feeBeneficiaries: SolanaFeeBeneficiaryEffective[];
  allowBuy: boolean;
  allowSell: boolean;
  tokenDecimals: number;
}

export interface CreateSolanaLaunchResponse {
  launchId: string;
  network: SolanaNetwork;
  signature: string;
  explorerUrl: string;
  statusUrl: string;
  predicted: CreateSolanaLaunchPredicted;
  effectiveConfig: SolanaEffectiveLaunchConfig;
}

export type CreateAnyLaunchResponse = CreateLaunchResponse | CreateSolanaLaunchResponse;

export type LaunchStatus = 'pending' | 'confirmed' | 'reverted' | 'not_found';

export interface LaunchResult {
  tokenAddress: HexAddress;
  poolOrHookAddress: HexAddress;
  poolId: HexHash;
  blockNumber: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface LaunchStatusResponse {
  launchId: string;
  chainId: number;
  txHash: HexHash;
  status: LaunchStatus;
  confirmations: number;
  result?: LaunchResult;
  error?: ApiErrorBody;
}

export interface SolanaLaunchReadResponse {
  network: SolanaNetwork;
  launchAddress: string;
  phase: {
    code: number;
    label: string;
  };
  authority: string;
  namespace: string;
  baseMint: string;
  quoteMint: string;
  baseVault: string;
  quoteVault: string;
  baseTotalSupply: string;
  baseForDistribution: string;
  baseForLiquidity: string;
  baseForCurve: string;
  curveVirtualBase: string;
  curveVirtualQuote: string;
  curveFeeBps: number;
  swapFeeBps: number;
  allowBuy: boolean;
  allowSell: boolean;
  hookProgram: string;
  hookFlags: number;
  migratorProgram: string;
  quoteDeposited: string;
  tokenDecimals: number;
}

export interface ChainCapability {
  chainId: number;
  auctionTypes: AuctionType[];
  multicurveInitializers?: Array<'rehype'>;
  migrationModes: MigrationType[];
  governanceModes: GovernanceMode[];
  governanceEnabled: boolean;
}

export interface CapabilitiesResponse {
  defaultChainId: number | null;
  pricing: {
    enabled: boolean;
    provider: string;
  };
  chains: ChainCapability[];
  solana?: {
    enabled: boolean;
    supportedNetworks: SolanaNetwork[];
    unsupportedNetworks: SolanaNetwork[];
    dedicatedRouteInputAliases: Array<'devnet' | 'mainnet-beta'>;
    creationOnly: true;
    numeraireAddress: string;
    priceResolutionModes: Array<'request' | 'fixed' | 'coingecko'>;
  };
}
