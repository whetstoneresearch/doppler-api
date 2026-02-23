export type HexAddress = `0x${string}`;
export type HexHash = `0x${string}`;

export type GovernanceMode = 'noOp' | 'default' | 'custom';
export type MigrationType = 'noOp' | 'uniswapV2' | 'uniswapV4';
export type AuctionType = 'multicurve' | 'static' | 'dynamic';

export interface TokenMetadata {
  name: string;
  symbol: string;
  tokenURI: string;
}

export interface Tokenomics {
  totalSupply: string;
  tokensForSale?: string;
  allocations?: {
    recipientAddress?: HexAddress;
    allocations?: Array<{
      address: HexAddress;
      amount: string;
    }>;
    recipients?: Array<{
      address: HexAddress;
      amount: string;
    }>;
    mode?: 'vest' | 'unlock' | 'vault';
    durationSeconds?: number;
    cliffDurationSeconds?: number;
  };
}

export interface PairingConfig {
  numeraireAddress?: HexAddress;
}

export interface PricingConfig {
  numerairePriceUsd?: number;
}

export interface FeeBeneficiaryInput {
  address: HexAddress;
  sharesWad: string;
}

export interface GovernanceConfig {
  enabled: boolean;
  mode?: GovernanceMode;
}

export interface MigrationConfigInput {
  type: MigrationType;
}

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

export type MulticurveInitializerConfig =
  | {
      type: 'standard';
    }
  | {
      type: 'scheduled';
      startTime: number;
    }
  | {
      type: 'decay';
      startFee: number;
      durationSeconds: number;
      startTime?: number;
    }
  | {
      type: 'rehype';
      config: {
        hookAddress: HexAddress;
        buybackDestination: HexAddress;
        customFee: number;
        assetBuybackPercentWad: string;
        numeraireBuybackPercentWad: string;
        beneficiaryPercentWad: string;
        lpPercentWad: string;
        graduationCalldata?: `0x${string}`;
        graduationMarketCap?: number;
        numerairePrice?: number;
        farTick?: number;
      };
    };

export interface AuctionConfig {
  type: AuctionType;
  curveConfig: CurveConfig;
  initializer?: MulticurveInitializerConfig;
}

export interface CreateLaunchRequest {
  chainId?: number;
  userAddress: HexAddress;
  integrationAddress?: HexAddress;
  tokenMetadata: TokenMetadata;
  tokenomics: Tokenomics;
  pairing?: PairingConfig;
  pricing?: PricingConfig;
  feeBeneficiaries?: FeeBeneficiaryInput[];
  governance?: GovernanceConfig | boolean;
  migration: MigrationConfigInput;
  auction: AuctionConfig;
}

export interface CreateLaunchPredicted {
  tokenAddress: HexAddress;
  poolId: HexHash;
  gasEstimate?: string;
}

export interface EffectiveLaunchConfig {
  tokensForSale: string;
  allocationAmount: string;
  allocationRecipient: HexAddress;
  allocationRecipients?: Array<{
    address: HexAddress;
    amount: string;
  }>;
  allocationLockMode: 'none' | 'vest' | 'unlock' | 'vault';
  allocationLockDurationSeconds: number;
  numeraireAddress: HexAddress;
  numerairePriceUsd: number;
  feeBeneficiariesSource: 'default' | 'request';
  initializer?:
    | { type: 'standard' }
    | { type: 'scheduled'; startTime: number }
    | {
        type: 'decay';
        startTime: number;
        startFee: number;
        endFee: number;
        durationSeconds: number;
      }
    | { type: 'rehype' };
}

export interface CreateLaunchResponse {
  launchId: string;
  chainId: number;
  txHash: HexHash;
  statusUrl: string;
  predicted: CreateLaunchPredicted;
  effectiveConfig: EffectiveLaunchConfig;
}

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

export interface ChainCapability {
  chainId: number;
  auctionTypes: AuctionType[];
  multicurveInitializers?: Array<'standard' | 'scheduled' | 'decay' | 'rehype'>;
  migrationModes: MigrationType[];
  governanceModes: GovernanceMode[];
  governanceEnabled: boolean;
}

export interface CapabilitiesResponse {
  defaultChainId: number;
  pricing: {
    enabled: boolean;
    provider: string;
  };
  chains: ChainCapability[];
}
