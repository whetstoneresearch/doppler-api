import { decodeAbiParameters, encodeAbiParameters } from 'viem';

export interface DecodedLegacyTokenFactoryData {
  kind: 'legacy';
  yearlyMintRate: bigint;
  vestingDuration: bigint;
  recipients: readonly `0x${string}`[];
  amounts: readonly bigint[];
}

export interface DecodedV2TokenFactoryData {
  kind: 'v2';
  yearlyMintRate: bigint;
  schedules: ReadonlyArray<{ cliff: bigint; duration: bigint }>;
  recipients: readonly `0x${string}`[];
  scheduleIds: readonly bigint[];
  amounts: readonly bigint[];
}

export interface DecodedDopplerERC20V1TokenFactoryData {
  kind: 'dopplerERC20V1';
  schedules: ReadonlyArray<{ cliff: bigint; duration: bigint }>;
  recipients: readonly `0x${string}`[];
  scheduleIds: readonly bigint[];
  amounts: readonly bigint[];
  maxBalanceLimit: bigint;
  balanceLimitEnd: number;
  controller: `0x${string}`;
  excludedFromBalanceLimit: readonly `0x${string}`[];
}

export type DecodedStandardTokenFactoryData =
  | DecodedDopplerERC20V1TokenFactoryData
  | DecodedLegacyTokenFactoryData
  | DecodedV2TokenFactoryData;

export interface DecodedRehypeFeeDistributionInfo {
  assetFeesToAssetBuybackWad: bigint;
  assetFeesToNumeraireBuybackWad: bigint;
  assetFeesToBeneficiaryWad: bigint;
  assetFeesToLpWad: bigint;
  numeraireFeesToAssetBuybackWad: bigint;
  numeraireFeesToNumeraireBuybackWad: bigint;
  numeraireFeesToBeneficiaryWad: bigint;
  numeraireFeesToLpWad: bigint;
}

export interface DecodedRehypeInitCalldata {
  numeraire: `0x${string}`;
  buybackDst: `0x${string}`;
  startFee: number;
  endFee: number;
  durationSeconds: number;
  startingTime: number;
  feeRoutingMode: number;
  feeDistributionInfo: DecodedRehypeFeeDistributionInfo;
  feeBeneficiaries: ReadonlyArray<{
    beneficiary: `0x${string}`;
    shares: bigint;
  }>;
}

export interface DecodedDopplerHookMigratorData {
  fee: number;
  useDynamicFee: boolean;
  tickSpacing: number;
  lockDuration: number;
  beneficiaries: ReadonlyArray<{
    beneficiary: `0x${string}`;
    shares: bigint;
  }>;
  dopplerHook: `0x${string}`;
  onInitializationCalldata: `0x${string}`;
  proceedsRecipient: `0x${string}`;
  proceedsShare: bigint;
}

export interface DecodedRehypeMigratorInitCalldata {
  numeraire: `0x${string}`;
  buybackDst: `0x${string}`;
  customFee: number;
  feeRoutingMode: number;
  feeDistributionInfo: DecodedRehypeFeeDistributionInfo;
}

const v2ScheduleComponents = [
  { name: 'cliff', type: 'uint64' },
  { name: 'duration', type: 'uint64' },
] as const;

const dopplerERC20V1Parameters = [
  { name: 'name', type: 'string' },
  { name: 'symbol', type: 'string' },
  { name: 'schedules', type: 'tuple[]', components: v2ScheduleComponents },
  { name: 'beneficiaries', type: 'address[]' },
  { name: 'scheduleIds', type: 'uint256[]' },
  { name: 'amounts', type: 'uint256[]' },
  { name: 'tokenURI', type: 'string' },
  { name: 'maxBalanceLimit', type: 'uint256' },
  { name: 'balanceLimitEnd', type: 'uint48' },
  { name: 'controller', type: 'address' },
  { name: 'excludedFromBalanceLimit', type: 'address[]' },
] as const;

const decodeDopplerERC20V1TokenFactoryData = (
  tokenFactoryData: `0x${string}`,
): DecodedDopplerERC20V1TokenFactoryData => {
  const decoded = decodeAbiParameters(dopplerERC20V1Parameters, tokenFactoryData);
  const [
    ,
    ,
    schedules,
    recipients,
    scheduleIds,
    amounts,
    ,
    maxBalanceLimit,
    balanceLimitEnd,
    controller,
    excludedFromBalanceLimit,
  ] = decoded;

  if (
    recipients.length !== scheduleIds.length ||
    recipients.length !== amounts.length ||
    scheduleIds.some((scheduleId: bigint) => scheduleId >= BigInt(schedules.length)) ||
    encodeAbiParameters(dopplerERC20V1Parameters, decoded).toLowerCase() !==
      tokenFactoryData.toLowerCase()
  ) {
    throw new Error('Decoded token factory data is not valid DopplerERC20V1 data');
  }

  return {
    kind: 'dopplerERC20V1',
    schedules,
    recipients,
    scheduleIds,
    amounts,
    maxBalanceLimit,
    balanceLimitEnd,
    controller,
    excludedFromBalanceLimit,
  };
};

const decodeV2TokenFactoryData = (tokenFactoryData: `0x${string}`): DecodedV2TokenFactoryData => {
  const [, , yearlyMintRate, schedules, recipients, scheduleIds, amounts] = decodeAbiParameters(
    [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'yearlyMintRate', type: 'uint256' },
      { name: 'schedules', type: 'tuple[]', components: v2ScheduleComponents },
      { name: 'beneficiaries', type: 'address[]' },
      { name: 'scheduleIds', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'tokenURI', type: 'string' },
    ],
    tokenFactoryData,
  ) as readonly [
    string,
    string,
    bigint,
    ReadonlyArray<{ cliff: bigint; duration: bigint }>,
    readonly `0x${string}`[],
    readonly bigint[],
    readonly bigint[],
    string,
  ];

  if (
    schedules.length === 0 ||
    recipients.length !== scheduleIds.length ||
    recipients.length !== amounts.length ||
    scheduleIds.some((scheduleId) => scheduleId >= BigInt(schedules.length))
  ) {
    throw new Error('Decoded token factory data is not valid DERC20 V2 schedule data');
  }

  return {
    kind: 'v2',
    yearlyMintRate,
    schedules,
    recipients,
    scheduleIds,
    amounts,
  };
};

const decodeLegacyTokenFactoryData = (
  tokenFactoryData: `0x${string}`,
): DecodedLegacyTokenFactoryData => {
  const [, , yearlyMintRate, vestingDuration, recipients, amounts] = decodeAbiParameters(
    [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'yearlyMintRate', type: 'uint256' },
      { name: 'vestingDuration', type: 'uint256' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'tokenURI', type: 'string' },
    ],
    tokenFactoryData,
  ) as readonly [
    string,
    string,
    bigint,
    bigint,
    readonly `0x${string}`[],
    readonly bigint[],
    string,
  ];

  return {
    kind: 'legacy',
    yearlyMintRate,
    vestingDuration,
    recipients,
    amounts,
  };
};

export const decodeStandardTokenFactoryData = (
  tokenFactoryData: `0x${string}`,
): DecodedStandardTokenFactoryData => {
  try {
    return decodeDopplerERC20V1TokenFactoryData(tokenFactoryData);
  } catch {
    try {
      return decodeV2TokenFactoryData(tokenFactoryData);
    } catch {
      return decodeLegacyTokenFactoryData(tokenFactoryData);
    }
  }
};

const rehypeFeeDistributionComponents = [
  { name: 'assetFeesToAssetBuybackWad', type: 'uint256' },
  { name: 'assetFeesToNumeraireBuybackWad', type: 'uint256' },
  { name: 'assetFeesToBeneficiaryWad', type: 'uint256' },
  { name: 'assetFeesToLpWad', type: 'uint256' },
  { name: 'numeraireFeesToAssetBuybackWad', type: 'uint256' },
  { name: 'numeraireFeesToNumeraireBuybackWad', type: 'uint256' },
  { name: 'numeraireFeesToBeneficiaryWad', type: 'uint256' },
  { name: 'numeraireFeesToLpWad', type: 'uint256' },
] as const;

const rehypeInitDataComponents = [
  { name: 'numeraire', type: 'address' },
  { name: 'buybackDst', type: 'address' },
  { name: 'startFee', type: 'uint24' },
  { name: 'endFee', type: 'uint24' },
  { name: 'durationSeconds', type: 'uint32' },
  { name: 'startingTime', type: 'uint32' },
  { name: 'feeRoutingMode', type: 'uint8' },
  {
    name: 'feeDistributionInfo',
    type: 'tuple',
    components: rehypeFeeDistributionComponents,
  },
  {
    name: 'feeBeneficiaries',
    type: 'tuple[]',
    components: [
      { name: 'beneficiary', type: 'address' },
      { name: 'shares', type: 'uint96' },
    ],
  },
] as const;

export const decodeRehypeInitCalldata = (calldata: `0x${string}`): DecodedRehypeInitCalldata => {
  const [decoded] = decodeAbiParameters(
    [{ type: 'tuple', components: rehypeInitDataComponents }],
    calldata,
  ) as readonly [DecodedRehypeInitCalldata];

  return decoded;
};

export const decodeDopplerHookMigratorData = (
  calldata: `0x${string}`,
): DecodedDopplerHookMigratorData => {
  const [
    fee,
    useDynamicFee,
    tickSpacing,
    lockDuration,
    beneficiaries,
    dopplerHook,
    onInitializationCalldata,
    proceedsRecipient,
    proceedsShare,
  ] = decodeAbiParameters(
    [
      { type: 'uint24' },
      { type: 'bool' },
      { type: 'int24' },
      { type: 'uint32' },
      {
        type: 'tuple[]',
        components: [
          { name: 'beneficiary', type: 'address' },
          { name: 'shares', type: 'uint96' },
        ],
      },
      { type: 'address' },
      { type: 'bytes' },
      { type: 'address' },
      { type: 'uint256' },
    ],
    calldata,
  );

  return {
    fee,
    useDynamicFee,
    tickSpacing,
    lockDuration,
    beneficiaries,
    dopplerHook,
    onInitializationCalldata,
    proceedsRecipient,
    proceedsShare,
  };
};

export const decodeRehypeMigratorInitCalldata = (
  calldata: `0x${string}`,
): DecodedRehypeMigratorInitCalldata => {
  const [decoded] = decodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'numeraire', type: 'address' },
          { name: 'buybackDst', type: 'address' },
          { name: 'customFee', type: 'uint24' },
          { name: 'feeRoutingMode', type: 'uint8' },
          {
            name: 'feeDistributionInfo',
            type: 'tuple',
            components: rehypeFeeDistributionComponents,
          },
        ],
      },
    ],
    calldata,
  ) as readonly [DecodedRehypeMigratorInitCalldata];

  return decoded;
};
