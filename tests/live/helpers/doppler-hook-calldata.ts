import { decodeAbiParameters } from 'viem';

const curveTupleComponents = [
  { name: 'tickLower', type: 'int24' },
  { name: 'tickUpper', type: 'int24' },
  { name: 'numPositions', type: 'uint16' },
  { name: 'shares', type: 'uint256' },
] as const;

const beneficiaryTupleComponents = [
  { name: 'beneficiary', type: 'address' },
  { name: 'shares', type: 'uint96' },
] as const;

export interface DecodedDopplerHookInitializerData {
  fee: number;
  tickSpacing: number;
  farTick: number;
  curves: ReadonlyArray<{
    tickLower: number;
    tickUpper: number;
    numPositions: number;
    shares: bigint;
  }>;
  beneficiaries: ReadonlyArray<{
    beneficiary: `0x${string}`;
    shares: bigint;
  }>;
  dopplerHook: `0x${string}`;
  onInitializationDopplerHookCalldata: `0x${string}`;
  graduationDopplerHookCalldata: `0x${string}`;
}

export const decodeDopplerHookInitializerData = (
  poolInitializerData: `0x${string}`,
): DecodedDopplerHookInitializerData => {
  const [decoded] = decodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'farTick', type: 'int24' },
          { name: 'curves', type: 'tuple[]', components: curveTupleComponents },
          {
            name: 'beneficiaries',
            type: 'tuple[]',
            components: beneficiaryTupleComponents,
          },
          { name: 'dopplerHook', type: 'address' },
          { name: 'onInitializationDopplerHookCalldata', type: 'bytes' },
          { name: 'graduationDopplerHookCalldata', type: 'bytes' },
        ],
      },
    ],
    poolInitializerData,
  );

  return decoded;
};
