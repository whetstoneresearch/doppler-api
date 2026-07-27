// allow: SIZE_OK — the finite seven-recipe SDK contract matrix is intentionally colocated.
import {
  DopplerSDK,
  WAD,
  getAddresses,
  type CreateParams,
} from '@whetstone-research/doppler-sdk/evm';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters, zeroAddress } from 'viem';

import { createLaunchRequestSchema } from '../../src/modules/launches/schema';
import {
  normalizeFeeBeneficiaries,
  resolveAllocationPlan,
} from '../../src/modules/auctions/multicurve/mapper';
import {
  decodeDopplerHookMigratorData,
  decodeRehypeMigratorInitCalldata,
  decodeRehypeInitCalldata,
  decodeStandardTokenFactoryData,
} from '../live/helpers/calldata-decoders';
import { decodeDopplerHookInitializerData } from '../live/helpers/doppler-hook-calldata';

const CHAIN_ID = 84532 as const;
const USER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const OWNER = '0x3333333333333333333333333333333333333333';
const TOKEN = '0xf000000000000000000000000000000000000000';
const POOL = '0x2000000000000000000000000000000000000000';
const TIMELOCK = '0x3000000000000000000000000000000000000000';
const addresses = getAddresses(CHAIN_ID);
const requireAddress = (address: `0x${string}` | undefined, moduleName: string): `0x${string}` => {
  if (address === undefined) {
    throw new Error(`SDK fixture is missing ${moduleName}`);
  }
  return address;
};
const modules = {
  lockableV3Initializer: requireAddress(addresses.lockableV3Initializer, 'lockableV3Initializer'),
  dopplerHookInitializer: requireAddress(
    addresses.dopplerHookInitializer,
    'dopplerHookInitializer',
  ),
  rehypeDopplerHookInitializer: requireAddress(
    addresses.rehypeDopplerHookInitializer,
    'rehypeDopplerHookInitializer',
  ),
  v2MigratorSplit: requireAddress(addresses.v2MigratorSplit, 'v2MigratorSplit'),
  dopplerHookMigrator: requireAddress(addresses.dopplerHookMigrator, 'dopplerHookMigrator'),
  rehypeDopplerHookMigrator: requireAddress(
    addresses.rehypeDopplerHookMigrator,
    'rehypeDopplerHookMigrator',
  ),
  noOpMigrator: requireAddress(addresses.noOpMigrator, 'noOpMigrator'),
  noOpGovernanceFactory: requireAddress(addresses.noOpGovernanceFactory, 'noOpGovernanceFactory'),
  launchpadGovernanceFactory: requireAddress(
    addresses.launchpadGovernanceFactory,
    'launchpadGovernanceFactory',
  ),
} as const;
const sale = {
  initialSupply: 1_000_000n * 10n ** 18n,
  numTokensToSell: 800_000n * 10n ** 18n,
  numeraire: addresses.weth,
} as const;
const token = {
  type: 'dopplerERC20V1',
  name: 'Canonical Token',
  symbol: 'CAN',
  tokenURI: 'ipfs://canonical',
} as const;

const publicClient = {
  simulateContract: vi.fn(async () => ({
    request: { gas: 1_000_000n },
    result: [TOKEN, POOL, 0n, TIMELOCK],
  })),
  estimateContractGas: vi.fn(async () => 1_000_000n),
  getBlock: vi.fn(async () => ({ timestamp: 1_900_000_000n })),
  readContract: vi.fn(async (request: { readonly functionName: string }) => {
    switch (request.functionName) {
      case 'owner':
        return OWNER;
      case 'HOOK':
        return modules.dopplerHookInitializer;
      case 'poolManager':
        return addresses.poolManager;
      case 'dopplerDeployer':
        return addresses.dopplerDeployer;
      default:
        throw new Error(`Unexpected SDK read: ${request.functionName}`);
    }
  }),
};
const sdk = new DopplerSDK({ chainId: CHAIN_ID, publicClient });

const expectCanonicalCreateParams = (
  createParams: CreateParams,
  expected: {
    readonly initializer: `0x${string}`;
    readonly migrator: `0x${string}`;
    readonly governanceFactory: `0x${string}`;
  },
): void => {
  expect(createParams.initialSupply).toBe(sale.initialSupply);
  expect(createParams.numTokensToSell).toBe(sale.numTokensToSell);
  expect(createParams.numeraire).toBe(sale.numeraire);
  expect(createParams.tokenFactory).toBe(addresses.dopplerERC20V1Factory);
  expect(createParams.tokenFactoryData).toMatch(/^0x[0-9a-f]+$/i);
  expect(createParams.poolInitializer).toBe(expected.initializer);
  expect(createParams.poolInitializerData).toMatch(/^0x[0-9a-f]+$/i);
  expect(createParams.liquidityMigrator).toBe(expected.migrator);
  expect(createParams.liquidityMigratorData).toMatch(/^0x[0-9a-f]*$/i);
  expect(createParams.governanceFactory).toBe(expected.governanceFactory);
  expect(createParams.governanceFactoryData).toMatch(/^0x[0-9a-f]*$/i);
};

const staticBuilder = () =>
  sdk
    .buildStaticAuction()
    .tokenConfig(token)
    .saleConfig(sale)
    .withV3Initializer(modules.lockableV3Initializer)
    .withMigration({ type: 'noOp' })
    .withUserAddress(USER);

const multicurveBuilder = () =>
  sdk
    .buildMulticurveAuction()
    .tokenConfig(token)
    .saleConfig(sale)
    .withMigration({ type: 'noOp' })
    .withUserAddress(USER);

const dynamicBuilder = () =>
  sdk
    .buildDynamicAuction()
    .tokenConfig(token)
    .saleConfig(sale)
    .withMarketCapRange({
      marketCap: { start: 500_000, min: 50_000 },
      numerairePrice: 3_000,
      minProceeds: 10n * 10n ** 18n,
      maxProceeds: 1_000n * 10n ** 18n,
      fee: 3_000,
    })
    .withV4Initializer(addresses.v4Initializer)
    .withTime({ blockTimestamp: 1_900_000_000 })
    .withUserAddress(USER);

const resolveBeneficiaries = async (
  auction: Record<string, unknown>,
  poolFeeBeneficiaries?: readonly { readonly address: `0x${string}`; readonly sharesWad: string }[],
  migration?: Record<string, unknown>,
  economics: Record<string, unknown> = { totalSupply: sale.initialSupply.toString() },
) => {
  const input = createLaunchRequestSchema.parse({
    userAddress: USER,
    tokenMetadata: { name: token.name, symbol: token.symbol, tokenURI: token.tokenURI },
    economics,
    ...(poolFeeBeneficiaries === undefined ? {} : { poolFeeBeneficiaries }),
    ...(migration === undefined ? {} : { migration }),
    auction,
  });
  return {
    input,
    ...(await normalizeFeeBeneficiaries({ input, protocolOwner: OWNER })),
  };
};

const CANONICAL_ADDRESSES = {
  1: {
    dopplerERC20V1Factory: '0x89C261C05B5F9b6BcBA07C199b8DeE7cFaD45292',
    lockableV3Initializer: '0xA2E0435225D52a8B950122752978007D758056d7',
    dopplerHookInitializer: '0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544',
    rehypeDopplerHookInitializer: '0x9982538F41f2ae29ddb9d3D9307010052984FDbB',
    v4Initializer: '0x53b4c21a6Cb61D64F636ABBfa6E8E90E6558e8ad',
    v2MigratorSplit: '0xD7abA5f1d80a330a6fe9E96F7bA122710E0912d3',
    dopplerHookMigrator: '0x1E40b0875DDa35f41E15cFB475403859B8c860c4',
  },
  143: {
    dopplerERC20V1Factory: '0x89C261C05B5F9b6BcBA07C199b8DeE7cFaD45292',
    lockableV3Initializer: '0x8b4C7DB9121FC885689C0A50D5a1429F15AEc2a0',
    dopplerHookInitializer: '0x56ea13Da5f39863D3B3d54826187306Af7ada544',
    rehypeDopplerHookInitializer: '0x9982538F41f2ae29ddb9d3D9307010052984FDbB',
    v4Initializer: '0x53b4c21a6Cb61D64F636ABBfa6E8E90E6558e8ad',
    v2MigratorSplit: '0xD7abA5f1d80a330a6fe9E96F7bA122710E0912d3',
    dopplerHookMigrator: '0x1E40b0875DDa35f41E15cFB475403859B8c860c4',
  },
  4663: {
    dopplerERC20V1Factory: '0x1B37D3a72082029c44B35B604Ea473617580b69a',
    lockableV3Initializer: '0xde8886A0019Ea060B8378Ee37b8A23b8117F29A3',
    dopplerHookInitializer: '0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544',
    rehypeDopplerHookInitializer: '0x9982538F41f2ae29ddb9d3D9307010052984FDbB',
    v4Initializer: '0x6cce158B6D1747617fc218592B4D60B239B957ea',
    v2MigratorSplit: '0xB05046cEa797c993FB5b583098B1c4682e9Da333',
    dopplerHookMigrator: '0x7BF319d8e969f7596B1Bc171Da9ce322f67Ae0c4',
  },
  8453: {
    dopplerERC20V1Factory: '0x89C261C05B5F9b6BcBA07C199b8DeE7cFaD45292',
    lockableV3Initializer: '0xE0dC4012AC9C868F09c6e4b20d66ED46D6F258d0',
    dopplerHookInitializer: '0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544',
    rehypeDopplerHookInitializer: '0xBF4195ab0B03e1eB3345dd1e83BeD7650b1ed123',
    v4Initializer: '0x53b4c21a6Cb61D64F636ABBfa6E8E90E6558e8ad',
    v2MigratorSplit: '0xD7abA5f1d80a330a6fe9E96F7bA122710E0912d3',
    dopplerHookMigrator: '0x1E40b0875DDa35f41E15cFB475403859B8c860c4',
  },
  84532: {
    dopplerERC20V1Factory: '0x89C261C05B5F9b6BcBA07C199b8DeE7cFaD45292',
    lockableV3Initializer: '0x16AdA5Be50C3c2D94Af5fEae6b539C40A78Ad53c',
    dopplerHookInitializer: '0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544',
    rehypeDopplerHookInitializer: '0x78C79C95eacEb2D08f7a55cc0D31012f8aF510c3',
    v4Initializer: '0x53b4c21a6Cb61D64F636ABBfa6E8E90E6558e8ad',
    v2MigratorSplit: '0xD7abA5f1d80a330a6fe9E96F7bA122710E0912d3',
    dopplerHookMigrator: '0x1E40b0875DDa35f41E15cFB475403859B8c860c4',
  },
} as const;

describe('SDK 1.0.33 canonical EVM simulation matrix', () => {
  it('simulates static preset and manual-range subcases with independent vesting schedules', async () => {
    const packageJson = JSON.parse(
      readFileSync('node_modules/@whetstone-research/doppler-sdk/package.json', 'utf8'),
    ) as { readonly version: string };
    expect(packageJson.version).toBe('1.0.33');

    const presetBeneficiaries = await resolveBeneficiaries(
      {
        type: 'static',
        curveConfig: { type: 'preset', preset: 'low' },
      },
      undefined,
      undefined,
      {
        totalSupply: sale.initialSupply.toString(),
        tokensForSale: sale.numTokensToSell.toString(),
        allocations: [
          {
            recipientAddress: RECIPIENT,
            amount: (sale.initialSupply - sale.numTokensToSell).toString(),
            durationSeconds: 7_776_000,
            cliffDurationSeconds: 86_400,
          },
        ],
      },
    );
    const presetAllocation = resolveAllocationPlan({
      input: presetBeneficiaries.input,
      totalSupply: sale.initialSupply,
      tokensForSale: sale.numTokensToSell,
    });
    const presetParams = staticBuilder()
      .withBeneficiaries(presetBeneficiaries.beneficiaries)
      .withMarketCapRange({
        marketCap: { start: 7_500, end: 30_000 },
        numerairePrice: 3_000,
      })
      .withVesting({
        allocations: presetAllocation.allocations.map((allocation) => ({
          recipient: allocation.recipient,
          amount: allocation.amount,
          schedule: {
            duration: BigInt(allocation.durationSeconds),
            cliffDuration: allocation.cliffDurationSeconds,
          },
        })),
      })
      .withGovernance({ type: 'noOp' })
      .build();
    const presetSimulation = await sdk.factory.simulateCreateStaticAuction(presetParams);

    expect(presetBeneficiaries.source).toBe('default');
    expect(presetAllocation.allocations).toHaveLength(1);
    expect(presetParams.token).toEqual(token);
    expect(presetParams.pool.beneficiaries).toEqual([
      { beneficiary: USER, shares: (WAD * 95n) / 100n },
      { beneficiary: OWNER, shares: (WAD * 5n) / 100n },
    ]);
    expect(presetParams.vesting).toEqual({
      allocations: [
        {
          recipient: RECIPIENT,
          amount: sale.initialSupply - sale.numTokensToSell,
          schedule: { duration: 7_776_000, cliffDuration: 86_400 },
        },
      ],
    });
    expect(presetParams.governance).toEqual({ type: 'noOp' });
    expect(presetParams.migration).toEqual({ type: 'noOp' });
    expectCanonicalCreateParams(presetSimulation.createParams, {
      initializer: modules.lockableV3Initializer,
      migrator: modules.noOpMigrator,
      governanceFactory: modules.noOpGovernanceFactory,
    });
    expect(
      decodeStandardTokenFactoryData(presetSimulation.createParams.tokenFactoryData),
    ).toMatchObject({
      kind: 'dopplerERC20V1',
      recipients: [RECIPIENT],
      amounts: [sale.initialSupply - sale.numTokensToSell],
      schedules: [{ cliff: 86_400n, duration: 7_776_000n }],
    });

    const requestBeneficiaries = await resolveBeneficiaries(
      {
        type: 'static',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 20_000,
          marketCapEndUsd: 80_000,
        },
      },
      [{ address: RECIPIENT, sharesWad: ((WAD * 95n) / 100n).toString() }],
      undefined,
      {
        totalSupply: sale.initialSupply.toString(),
        tokensForSale: sale.numTokensToSell.toString(),
        allocations: [
          {
            recipientAddress: OWNER,
            amount: (sale.initialSupply - sale.numTokensToSell).toString(),
            durationSeconds: 2_592_000,
          },
        ],
      },
    );
    const manualAllocation = resolveAllocationPlan({
      input: requestBeneficiaries.input,
      totalSupply: sale.initialSupply,
      tokensForSale: sale.numTokensToSell,
    });
    const manualParams = staticBuilder()
      .tokenConfig({
        ...token,
        maxBalanceLimit: 10_000n * 10n ** 18n,
        balanceLimitEnd: 2_000_000_000,
        controller: USER,
        excludedFromBalanceLimit: [RECIPIENT],
      })
      .withBeneficiaries(requestBeneficiaries.beneficiaries)
      .withMarketCapRange({
        marketCap: { start: 20_000, end: 80_000 },
        numerairePrice: 3_000,
      })
      .withVesting({
        allocations: manualAllocation.allocations.map((allocation) => ({
          recipient: allocation.recipient,
          amount: allocation.amount,
          schedule: {
            duration: BigInt(allocation.durationSeconds),
            cliffDuration: allocation.cliffDurationSeconds,
          },
        })),
      })
      .withGovernance({ type: 'noOp' })
      .build();
    const manualSimulation = await sdk.factory.simulateCreateStaticAuction(manualParams);
    const manualTokenData = decodeStandardTokenFactoryData(
      manualSimulation.createParams.tokenFactoryData,
    );

    expect(requestBeneficiaries.source).toBe('request');
    expect(manualParams.token).toEqual({
      ...token,
      maxBalanceLimit: 10_000n * 10n ** 18n,
      balanceLimitEnd: 2_000_000_000,
      controller: USER,
      excludedFromBalanceLimit: [RECIPIENT],
    });
    expect(manualParams.pool).not.toEqual(presetParams.pool);
    expect(manualParams.pool.beneficiaries).toEqual(requestBeneficiaries.beneficiaries);
    expect(manualParams.vesting).toEqual({
      allocations: [
        {
          recipient: OWNER,
          amount: sale.initialSupply - sale.numTokensToSell,
          schedule: { duration: 2_592_000, cliffDuration: 0 },
        },
      ],
    });
    expectCanonicalCreateParams(manualSimulation.createParams, {
      initializer: modules.lockableV3Initializer,
      migrator: modules.noOpMigrator,
      governanceFactory: modules.noOpGovernanceFactory,
    });
    expect(manualTokenData).toMatchObject({
      kind: 'dopplerERC20V1',
      recipients: [OWNER],
      amounts: [sale.initialSupply - sale.numTokensToSell],
      schedules: [{ cliff: 0n, duration: 2_592_000n }],
      maxBalanceLimit: 10_000n * 10n ** 18n,
      balanceLimitEnd: 2_000_000_000,
      controller: USER,
    });
  });

  it('simulates standard multicurve low/medium/high presets with default beneficiaries', async () => {
    const normalized = await resolveBeneficiaries({
      type: 'multicurve',
      curveConfig: { type: 'preset', presets: ['low', 'medium', 'high'] },
    });
    const params = multicurveBuilder()
      .withMarketCapPresets({
        presets: ['low', 'medium', 'high'],
        beneficiaries: normalized.beneficiaries,
      })
      .withDopplerHookInitializer(modules.dopplerHookInitializer)
      .withGovernance({ type: 'default' })
      .build();
    const { createParams } = await sdk.factory.simulateCreateMulticurve(params);

    expect(normalized.source).toBe('default');
    expect(params.token).toEqual(token);
    expect(params.pool.curves).toHaveLength(4);
    expect(params.pool.beneficiaries).toEqual(normalized.beneficiaries);
    expect(params.initializer).toEqual({ type: 'standard' });
    expect(params.vesting).toBeUndefined();
    expect(params.governance).toEqual({ type: 'default' });
    expect(params.migration).toEqual({ type: 'noOp' });
    expectCanonicalCreateParams(createParams, {
      initializer: modules.dopplerHookInitializer,
      migrator: modules.noOpMigrator,
      governanceFactory: addresses.governanceFactory,
    });
    expect(decodeStandardTokenFactoryData(createParams.tokenFactoryData)).toMatchObject({
      kind: 'dopplerERC20V1',
      recipients: [],
      amounts: [],
    });
  });

  it('simulates multicurve manual ranges including max with split vesting and request beneficiaries', async () => {
    const normalized = await resolveBeneficiaries(
      {
        type: 'multicurve',
        curveConfig: {
          type: 'ranges',
          curves: [
            {
              marketCapStartUsd: 10_000,
              marketCapEndUsd: 100_000,
              numPositions: 10,
              sharesWad: (WAD / 2n).toString(),
            },
            {
              marketCapStartUsd: 100_000,
              marketCapEndUsd: 'max',
              numPositions: 10,
              sharesWad: (WAD / 2n).toString(),
            },
          ],
        },
      },
      [{ address: RECIPIENT, sharesWad: ((WAD * 95n) / 100n).toString() }],
    );
    const params = multicurveBuilder()
      .withCurves({
        numerairePrice: 3_000,
        curves: [
          { marketCap: { start: 10_000, end: 100_000 }, numPositions: 10, shares: WAD / 2n },
          { marketCap: { start: 100_000, end: 'max' }, numPositions: 10, shares: WAD / 2n },
        ],
        beneficiaries: normalized.beneficiaries,
      })
      .withVesting({
        allocations: [
          {
            recipient: OWNER,
            amount: 10_000n * 10n ** 18n,
            schedule: { cliffDuration: 86_400, duration: 7_776_000n },
          },
          {
            recipient: RECIPIENT,
            amount: 10_000n * 10n ** 18n,
            schedule: { cliffDuration: 172_800, duration: 15_552_000n },
          },
        ],
      })
      .withDopplerHookInitializer(modules.dopplerHookInitializer)
      .withGovernance({ type: 'noOp' })
      .build();
    const { createParams } = await sdk.factory.simulateCreateMulticurve(params);

    expect(normalized.source).toBe('request');
    expect(params.token).toEqual(token);
    expect(params.pool.curves).toHaveLength(2);
    expect(params.pool.beneficiaries).toEqual(normalized.beneficiaries);
    expect(params.initializer).toEqual({ type: 'standard' });
    expect(params.vesting?.allocations).toEqual([
      {
        recipient: OWNER,
        amount: 10_000n * 10n ** 18n,
        schedule: { cliffDuration: 86_400, duration: 7_776_000 },
      },
      {
        recipient: RECIPIENT,
        amount: 10_000n * 10n ** 18n,
        schedule: { cliffDuration: 172_800, duration: 15_552_000 },
      },
    ]);
    expect(params.governance).toEqual({ type: 'noOp' });
    expect(params.migration).toEqual({ type: 'noOp' });
    expectCanonicalCreateParams(createParams, {
      initializer: modules.dopplerHookInitializer,
      migrator: modules.noOpMigrator,
      governanceFactory: modules.noOpGovernanceFactory,
    });
    expect(decodeStandardTokenFactoryData(createParams.tokenFactoryData)).toMatchObject({
      kind: 'dopplerERC20V1',
      recipients: [OWNER, RECIPIENT],
      scheduleIds: [0n, 1n],
      amounts: [10_000n * 10n ** 18n, 10_000n * 10n ** 18n],
    });
  });

  it('simulates Rehype multicurve with three fee beneficiaries and separate pool beneficiaries', async () => {
    const normalized = await resolveBeneficiaries(
      {
        type: 'multicurve',
        curveConfig: { type: 'preset', presets: ['medium'] },
        initializer: {
          type: 'rehype',
          config: {
            rehypeFeeBeneficiaries: [
              { address: USER, sharesWad: (WAD / 5n).toString() },
              { address: RECIPIENT, sharesWad: ((WAD * 3n) / 10n).toString() },
              {
                address: '0x4444444444444444444444444444444444444444',
                sharesWad: (WAD / 2n).toString(),
              },
            ],
            startFee: 5_000,
            endFee: 3_000,
            durationSeconds: 86_400,
            feeDistributionInfo: {
              assetFeesToAssetBuybackWad: '0',
              assetFeesToNumeraireBuybackWad: '0',
              assetFeesToBeneficiaryWad: WAD.toString(),
              assetFeesToLpWad: '0',
              numeraireFeesToAssetBuybackWad: '0',
              numeraireFeesToNumeraireBuybackWad: '0',
              numeraireFeesToBeneficiaryWad: WAD.toString(),
              numeraireFeesToLpWad: '0',
            },
          },
        },
      },
      [{ address: RECIPIENT, sharesWad: ((WAD * 95n) / 100n).toString() }],
    );
    const params = multicurveBuilder()
      .withMarketCapPresets({
        presets: ['medium'],
        beneficiaries: normalized.beneficiaries,
      })
      .withRehypeDopplerHookInitializer({
        hookAddress: modules.rehypeDopplerHookInitializer,
        feeBeneficiaries: [
          { beneficiary: USER, shares: WAD / 5n },
          { beneficiary: RECIPIENT, shares: (WAD * 3n) / 10n },
          {
            beneficiary: '0x4444444444444444444444444444444444444444',
            shares: WAD / 2n,
          },
        ],
        startFee: 5_000,
        endFee: 3_000,
        durationSeconds: 86_400,
        feeDistributionInfo: {
          assetFeesToAssetBuybackWad: 0n,
          assetFeesToNumeraireBuybackWad: 0n,
          assetFeesToBeneficiaryWad: WAD,
          assetFeesToLpWad: 0n,
          numeraireFeesToAssetBuybackWad: 0n,
          numeraireFeesToNumeraireBuybackWad: 0n,
          numeraireFeesToBeneficiaryWad: WAD,
          numeraireFeesToLpWad: 0n,
        },
      })
      .withDopplerHookInitializer(modules.dopplerHookInitializer)
      .withGovernance({ type: 'launchpad', multisig: OWNER })
      .build();
    const { createParams } = await sdk.factory.simulateCreateMulticurve(params);

    expect(normalized.source).toBe('request');
    expect(params.token).toEqual(token);
    expect(params.pool.beneficiaries).toEqual(normalized.beneficiaries);
    expect(params.initializer).toMatchObject({
      type: 'rehype',
      config: {
        hookAddress: modules.rehypeDopplerHookInitializer,
        feeBeneficiaries: [
          { beneficiary: USER, shares: WAD / 5n },
          { beneficiary: RECIPIENT, shares: (WAD * 3n) / 10n },
          {
            beneficiary: '0x4444444444444444444444444444444444444444',
            shares: WAD / 2n,
          },
        ],
        startFee: 5_000,
        endFee: 3_000,
        durationSeconds: 86_400,
      },
    });
    expect(params.vesting).toBeUndefined();
    expect(params.governance).toEqual({ type: 'launchpad', multisig: OWNER });
    expect(params.migration).toEqual({ type: 'noOp' });
    expectCanonicalCreateParams(createParams, {
      initializer: modules.dopplerHookInitializer,
      migrator: modules.noOpMigrator,
      governanceFactory: modules.launchpadGovernanceFactory,
    });
    expect(decodeStandardTokenFactoryData(createParams.tokenFactoryData)).toMatchObject({
      kind: 'dopplerERC20V1',
      recipients: [],
      amounts: [],
    });
    const decodedPool = decodeDopplerHookInitializerData(createParams.poolInitializerData);
    const decodedRehype = decodeRehypeInitCalldata(decodedPool.onInitializationDopplerHookCalldata);
    expect(decodedPool.beneficiaries).toEqual(normalized.beneficiaries);
    expect(decodedRehype.buybackDst).toBe(zeroAddress);
    expect(decodedRehype.feeRoutingMode).toBe(1);
    expect(decodedRehype.feeBeneficiaries).toEqual([
      { beneficiary: USER, shares: WAD / 5n },
      { beneficiary: RECIPIENT, shares: (WAD * 3n) / 10n },
      {
        beneficiary: '0x4444444444444444444444444444444444444444',
        shares: WAD / 2n,
      },
    ]);
    expect(
      decodedRehype.feeBeneficiaries.some(
        (beneficiary) => beneficiary.beneficiary.toLowerCase() === OWNER.toLowerCase(),
      ),
    ).toBe(false);
  });

  it.each([
    ['without fee beneficiary', undefined],
    ['with an exact 25% proceeds split', { recipient: RECIPIENT, share: WAD / 4n }],
  ] as const)('simulates dynamic V2 Split %s', async (_label, proceedsSplit) => {
    const params = dynamicBuilder()
      .withV2MigratorSplit(modules.v2MigratorSplit)
      .withGovernance({ type: 'noOp' })
      .withMigration({ type: 'uniswapV2Split', ...(proceedsSplit ? { proceedsSplit } : {}) })
      .build();
    const { createParams } = await sdk.factory.simulateCreateDynamicAuction(params);
    const [encodedRecipient, encodedShare] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      createParams.liquidityMigratorData,
    );

    expect(params.token).toEqual(token);
    expect(params.pool).toEqual({ fee: 3_000, tickSpacing: 30 });
    expect(params.vesting).toBeUndefined();
    expect(params.governance).toEqual({ type: 'noOp' });
    expect(params.migration).toEqual({
      type: 'uniswapV2Split',
      ...(proceedsSplit ? { proceedsSplit } : {}),
    });
    expect('beneficiaries' in params.migration).toBe(false);
    expect(encodedRecipient).toBe(proceedsSplit?.recipient ?? zeroAddress);
    expect(encodedShare).toBe(proceedsSplit?.share ?? 0n);
    expectCanonicalCreateParams(createParams, {
      initializer: addresses.v4Initializer,
      migrator: modules.v2MigratorSplit,
      governanceFactory: modules.noOpGovernanceFactory,
    });
    expect(decodeStandardTokenFactoryData(createParams.tokenFactoryData)).toMatchObject({
      kind: 'dopplerERC20V1',
      recipients: [],
      amounts: [],
    });
  });

  it('simulates fixed-fee dynamic uniswapV4 with beneficiaries, governance, vesting, and V1 controls', async () => {
    const migration = {
      type: 'uniswapV4',
      fee: 3_000,
      tickSpacing: 60,
      lockDurationSeconds: 2_592_000,
    } as const;
    const normalized = await resolveBeneficiaries(
      {
        type: 'dynamic',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 500_000,
          marketCapMinUsd: 50_000,
          minProceeds: '10',
          maxProceeds: '1000',
        },
      },
      [{ address: RECIPIENT, sharesWad: ((WAD * 95n) / 100n).toString() }],
      migration,
    );
    const params = dynamicBuilder()
      .tokenConfig({ ...token, maxBalanceLimit: 1n, balanceLimitEnd: 2_000_000_000 })
      .withVesting({
        allocations: [
          {
            recipient: RECIPIENT,
            amount: 10_000n * 10n ** 18n,
            schedule: { duration: 7_776_000n, cliffDuration: 86_400 },
          },
        ],
      })
      .withDopplerHookMigrator(modules.dopplerHookMigrator)
      .withGovernance({ type: 'launchpad', multisig: OWNER })
      .withMigration({
        type: 'dopplerHook',
        fee: 3_000,
        tickSpacing: 60,
        lockDuration: 2_592_000,
        beneficiaries: normalized.beneficiaries,
      })
      .build();
    const { createParams } = await sdk.factory.simulateCreateDynamicAuction(params);

    expect(normalized.source).toBe('request');
    expect(params.token).toEqual({
      ...token,
      maxBalanceLimit: 1n,
      balanceLimitEnd: 2_000_000_000,
    });
    expect(params.pool).toEqual({ fee: 3_000, tickSpacing: 30 });
    expect(params.vesting).toEqual({
      allocations: [
        {
          recipient: RECIPIENT,
          amount: 10_000n * 10n ** 18n,
          schedule: { duration: 7_776_000, cliffDuration: 86_400 },
        },
      ],
    });
    expect(params.governance).toEqual({ type: 'launchpad', multisig: OWNER });
    expect(params.migration).toEqual({
      type: 'dopplerHook',
      fee: 3_000,
      tickSpacing: 60,
      lockDuration: 2_592_000,
      beneficiaries: normalized.beneficiaries,
    });
    expectCanonicalCreateParams(createParams, {
      initializer: addresses.v4Initializer,
      migrator: modules.dopplerHookMigrator,
      governanceFactory: modules.launchpadGovernanceFactory,
    });
    expect(decodeStandardTokenFactoryData(createParams.tokenFactoryData)).toMatchObject({
      kind: 'dopplerERC20V1',
      recipients: [RECIPIENT],
      amounts: [10_000n * 10n ** 18n],
      schedules: [{ cliff: 86_400n, duration: 7_776_000n }],
      maxBalanceLimit: 1n,
      balanceLimitEnd: 2_000_000_000,
    });
    const decodedMigration = decodeDopplerHookMigratorData(createParams.liquidityMigratorData);
    expect(decodedMigration.useDynamicFee).toBe(false);
    expect(decodedMigration.dopplerHook).toBe(zeroAddress);
    expect(decodedMigration.onInitializationCalldata).toBe('0x');
    expect(decodedMigration.proceedsRecipient).toBe(zeroAddress);
    expect(decodedMigration.proceedsShare).toBe(0n);
  });

  it('simulates RehypeDopplerHookMigrator with separate fixed LP and hook fees', async () => {
    const feeDistributionInfo = {
      assetFeesToAssetBuybackWad: WAD,
      assetFeesToNumeraireBuybackWad: 0n,
      assetFeesToBeneficiaryWad: 0n,
      assetFeesToLpWad: 0n,
      numeraireFeesToAssetBuybackWad: 0n,
      numeraireFeesToNumeraireBuybackWad: WAD / 4n,
      numeraireFeesToBeneficiaryWad: WAD / 4n,
      numeraireFeesToLpWad: WAD / 2n,
    };
    const params = dynamicBuilder()
      .withRehypeDopplerHookMigrator(modules.rehypeDopplerHookMigrator)
      .withGovernance({ type: 'noOp' })
      .withMigration({
        type: 'dopplerHook',
        fee: 3_000,
        tickSpacing: 60,
        lockDuration: 604_800,
        beneficiaries: [
          { beneficiary: RECIPIENT, shares: (WAD * 95n) / 100n },
          { beneficiary: OWNER, shares: (WAD * 5n) / 100n },
        ],
        rehype: {
          buybackDestination: RECIPIENT,
          customFee: 10_000,
          feeRoutingMode: 'routeToBeneficiaryFees',
          feeDistributionInfo,
        },
      })
      .build();

    const { createParams } = await sdk.factory.simulateCreateDynamicAuction(params);
    expectCanonicalCreateParams(createParams, {
      initializer: addresses.v4Initializer,
      migrator: modules.dopplerHookMigrator,
      governanceFactory: modules.noOpGovernanceFactory,
    });

    const decodedMigration = decodeDopplerHookMigratorData(createParams.liquidityMigratorData);
    expect(decodedMigration.fee).toBe(3_000);
    expect(decodedMigration.useDynamicFee).toBe(false);
    expect(decodedMigration.tickSpacing).toBe(60);
    expect(decodedMigration.lockDuration).toBe(604_800);
    expect(decodedMigration.dopplerHook).toBe(modules.rehypeDopplerHookMigrator);
    expect(decodedMigration.proceedsRecipient).toBe(zeroAddress);
    expect(decodedMigration.proceedsShare).toBe(0n);

    const decodedRehype = decodeRehypeMigratorInitCalldata(
      decodedMigration.onInitializationCalldata,
    );
    expect(decodedRehype).toEqual({
      numeraire: sale.numeraire,
      buybackDst: RECIPIENT,
      customFee: 10_000,
      feeRoutingMode: 1,
      feeDistributionInfo,
    });
  });
});

describe('canonical address and negative public matrix', () => {
  it.each([1, 143, 4663, 8453, 84532] as const)(
    'exposes every required canonical module on chain %s',
    (chainId: keyof typeof CANONICAL_ADDRESSES) => {
      const chainAddresses = getAddresses(chainId);
      expect(chainAddresses).toMatchObject(CANONICAL_ADDRESSES[chainId]);
      for (const key of [
        'lockableV3Initializer',
        'dopplerHookInitializer',
        'rehypeDopplerHookInitializer',
        'v4Initializer',
        'v2MigratorSplit',
        'dopplerHookMigrator',
        'rehypeDopplerHookMigrator',
        'dopplerERC20V1Factory',
        'governanceFactory',
      ] as const) {
        expect(chainAddresses[key], `${chainId}.${key}`).toMatch(/^0x[0-9a-f]{40}$/i);
      }
    },
  );

  it.each([
    ['legacy key', { feeBeneficiaries: [] }],
    ['scheduled initializer', { auction: { initializer: { type: 'scheduled', startTime: 1 } } }],
    ['decay initializer', { auction: { initializer: { type: 'decay', startFee: 5_000 } } }],
    [
      'manual Rehype fee routing mode',
      { auction: { initializer: { type: 'rehype', config: { feeRoutingMode: 1 } } } },
    ],
    ['V2 top-level beneficiaries', { migration: { type: 'uniswapV2' }, poolFeeBeneficiaries: [] }],
    [
      'fee beneficiary above 50%',
      {
        migration: {
          type: 'uniswapV2',
          feeBeneficiary: { address: USER, percentage: 51 },
        },
      },
    ],
    [
      'zero fee beneficiary percentage',
      {
        migration: {
          type: 'uniswapV2',
          feeBeneficiary: { address: USER, percentage: 0 },
        },
      },
    ],
    [
      'SDK proceeds split',
      {
        migration: {
          type: 'uniswapV2',
          proceedsSplit: { recipientAddress: USER, shareWad: '250000000000000000' },
        },
      },
    ],
    ['public V4', { migration: { type: 'uniswapV4' } }],
    ['public noOp', { migration: { type: 'noOp' } }],
    ['public V3', { migration: { type: 'uniswapV3' } }],
  ])('rejects %s', (_label, override) => {
    const base = {
      userAddress: USER,
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000000' },
      migration: { type: 'uniswapV2' },
      auction: {
        type: 'dynamic',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 500_000,
          marketCapMinUsd: 50_000,
          minProceeds: '1',
          maxProceeds: '10',
        },
      },
    };
    const candidate = {
      ...base,
      ...override,
      auction: { ...base.auction, ...('auction' in override ? override.auction : {}) },
    };
    expect(createLaunchRequestSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects a missing required SDK module before simulation', async () => {
    const params = dynamicBuilder()
      .withDopplerHookMigrator('0x0000000000000000000000000000000000000000')
      .withGovernance({ type: 'noOp' })
      .withMigration({
        type: 'dopplerHook',
        fee: 3_000,
        tickSpacing: 60,
        lockDuration: 1,
        beneficiaries: [],
      })
      .build();

    await expect(sdk.factory.simulateCreateDynamicAuction(params)).rejects.toThrow();
  });

  it('never exposes a transaction submission method at the mocked public-client boundary', () => {
    expect(Object.keys(publicClient)).not.toContain('writeContract');
    expect(Object.keys(publicClient)).not.toContain('sendTransaction');
  });

  it('retries cleanly after two aborted simulations without submitting', async () => {
    const simulateContract = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
      .mockRejectedValueOnce(new DOMException('cancelled again', 'AbortError'))
      .mockResolvedValue({
        request: { gas: 1_000_000n },
        result: [TOKEN, POOL, 0n, TIMELOCK],
      });
    const retryPublicClient = { ...publicClient, simulateContract };
    const retrySdk = new DopplerSDK({
      chainId: CHAIN_ID,
      publicClient: retryPublicClient,
    });
    const params = retrySdk
      .buildMulticurveAuction()
      .tokenConfig(token)
      .saleConfig(sale)
      .withMarketCapPresets({
        presets: ['low'],
        beneficiaries: [{ beneficiary: OWNER, shares: WAD }],
      })
      .withDopplerHookInitializer(modules.dopplerHookInitializer)
      .withGovernance({ type: 'noOp' })
      .withMigration({ type: 'noOp' })
      .withUserAddress(USER)
      .build();

    await expect(retrySdk.factory.simulateCreateMulticurve(params)).rejects.toThrow('cancelled');
    await expect(retrySdk.factory.simulateCreateMulticurve(params)).rejects.toThrow(
      'cancelled again',
    );
    await expect(retrySdk.factory.simulateCreateMulticurve(params)).resolves.toMatchObject({
      tokenAddress: TOKEN,
    });
    expect(simulateContract).toHaveBeenCalledTimes(3);
    expect(Object.keys(retryPublicClient)).not.toContain('writeContract');
  });
});
