import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/core/config';
import { createLaunchRequestSchema } from '../../src/modules/launches/schema';
import {
  dedicatedSolanaCreateLaunchRequestSchema,
  genericSolanaCreateLaunchRequestSchema,
} from '../../src/modules/launches/solana-schema';
import { readOpenApiExample } from '../fixtures/openapi';

const root = resolve(__dirname, '../..');
const originalEnvironment = { ...process.env };
const namedRpcEnvironments = [
  { chainId: 1, name: 'ETHEREUM_RPC_URL' },
  { chainId: 143, name: 'MONAD_RPC_URL' },
  { chainId: 4663, name: 'ROBINHOOD_RPC_URL' },
  { chainId: 8453, name: 'BASE_RPC_URL' },
  { chainId: 84532, name: 'BASE_SEPOLIA_RPC_URL' },
] as const;

const canonicalExampleNames = [
  'StaticPresetCreateLaunchExample',
  'MulticurveBuybackCreateLaunchExample',
  'MulticurveBeneficiaryRoutingCreateLaunchExample',
  'DynamicUniswapV2CreateLaunchExample',
  'DynamicUniswapV4CreateLaunchExample',
  'DynamicRehypeUniswapV4CreateLaunchExample',
  'SharedRouteSolanaCreateLaunchRequest',
] as const;

function readOpenApiSchemaBlock(name: string): string {
  const openApi = readFileSync(resolve(root, 'docs/openapi.yaml'), 'utf8');
  const schemaStart = openApi.indexOf(`    ${name}:\n`);
  if (schemaStart === -1) {
    throw new Error(`Missing OpenAPI schema ${name}`);
  }

  const schema = openApi.slice(schemaStart + name.length + 6);
  const nextSchema = schema.search(/^    [A-Za-z][A-Za-z0-9]+:\n/m);
  return nextSchema === -1 ? schema : schema.slice(0, nextSchema);
}

function documentedRequiredFields(name: string): readonly string[] {
  const required = readOpenApiSchemaBlock(name).match(/^      required: \[([^\]]+)\]$/m);
  if (!required?.[1]) {
    throw new Error(`Missing OpenAPI required fields for ${name}`);
  }
  return required[1].split(', ');
}

function documentedTopLevelProperties(name: string): readonly string[] {
  return Array.from(
    readOpenApiSchemaBlock(name).matchAll(/^        ([A-Za-z][A-Za-z0-9]*):$/gm),
    (match) => match[1],
  );
}

function openApiDocument(): string {
  return readFileSync(resolve(root, 'docs/openapi.yaml'), 'utf8');
}

function readOpenApiPathBlock(path: string): string {
  const openApi = openApiDocument();
  const pathStart = openApi.indexOf(`  ${path}:\n`);
  if (pathStart === -1) {
    throw new Error(`Missing OpenAPI path ${path}`);
  }

  const pathBlock = openApi.slice(pathStart + path.length + 4);
  const nextPath = pathBlock.search(/^  \/[^\n]+:\n/m);
  return nextPath === -1 ? pathBlock : pathBlock.slice(0, nextPath);
}

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('documentation contract', () => {
  it('documents only named EVM RPC variables', () => {
    const environment = parse(readFileSync(resolve(root, '.env.example'), 'utf8'));

    expect(environment).not.toHaveProperty('RPC_URL');
    expect(environment).toHaveProperty('DEFAULT_CHAIN_ID');
    expect(environment).toHaveProperty('DEFAULT_NUMERAIRE_ADDRESS');
    for (const { name } of namedRpcEnvironments) {
      expect(environment).toHaveProperty(name);
    }
  });

  it('validates canonical OpenAPI launch examples against the runtime schemas', () => {
    const examples = canonicalExampleNames.map(readOpenApiExample);

    const evmExamples = examples.slice(0, -1);
    const solanaExample = examples.at(-1);

    for (const example of evmExamples) {
      expect(createLaunchRequestSchema.safeParse(example).success).toBe(true);
    }
    expect(genericSolanaCreateLaunchRequestSchema.safeParse(solanaExample).success).toBe(true);
  });

  it.each(namedRpcEnvironments)(
    'resolves the .env.example with only %s configured',
    ({ chainId, name }) => {
      const environment = parse(readFileSync(resolve(root, '.env.example'), 'utf8'));
      process.env = {
        ...environment,
        API_KEY: 'test-key',
        PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945386f3f6f3d1063f4042afe30de8f34a4c9e',
        [name]: `https://rpc-${chainId}.example`,
      };

      const config = loadConfig();

      expect(config.defaultChainId).toBeNull();
      expect(Object.keys(config.chains).map(Number)).toEqual([chainId]);
    },
  );

  it('keeps integer and Solana OpenAPI contracts aligned with runtime schemas', () => {
    const integerPattern = readOpenApiSchemaBlock('IntegerString').match(
      /^      pattern: '([^']+)'$/m,
    )?.[1];
    if (!integerPattern) {
      throw new Error('Missing IntegerString pattern');
    }

    expect(integerPattern).toBe('^\\d+$');
    expect(new RegExp(integerPattern).test('123')).toBe(true);
    expect(new RegExp(integerPattern).test('\\d')).toBe(false);

    const minimalGenericSolanaRequest = {
      network: 'solanaDevnet',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000' },
      auction: {
        type: 'xyk',
        curveConfig: { type: 'range', marketCapStartUsd: 100, marketCapEndUsd: 1000 },
      },
    };
    const fullGenericSolanaRequest = {
      ...minimalGenericSolanaRequest,
      pairing: { numeraireAddress: '11111111111111111111111111111111' },
      pricing: { numerairePriceUsd: 1 },
      economics: {
        totalSupply: '1000',
        baseForDistribution: '1',
        baseForLiquidity: '1',
      },
      feeBeneficiaries: [{ address: '11111111111111111111111111111111', shareBps: 10000 }],
      governance: false,
      migration: { type: 'none', supportCpmm: true, minimumQuoteRaise: '1' },
      auction: {
        type: 'xyk',
        curveConfig: { type: 'range', marketCapStartUsd: 100, marketCapEndUsd: 1000 },
        curveFeeBps: 25,
        swapFeeBps: 25,
        allowBuy: true,
        allowSell: true,
        cosignerGate: {
          type: 'cosigner',
          expiry: { mode: 'unixTimestamp', value: '1' },
        },
        dynamicFee: { startingTime: '0', startFeeBps: 100, endFeeBps: 50, durationSeconds: '1' },
      },
    };

    expect(
      genericSolanaCreateLaunchRequestSchema.safeParse(minimalGenericSolanaRequest).success,
    ).toBe(true);
    expect(genericSolanaCreateLaunchRequestSchema.safeParse(fullGenericSolanaRequest).success).toBe(
      true,
    );
    expect(
      dedicatedSolanaCreateLaunchRequestSchema.safeParse({
        ...minimalGenericSolanaRequest,
        network: undefined,
      }).success,
    ).toBe(true);

    expect(documentedRequiredFields('SharedRouteSolanaCreateLaunchRequest')).toEqual([
      'network',
      'tokenMetadata',
      'economics',
      'auction',
    ]);
    expect(documentedRequiredFields('DedicatedSolanaCreateLaunchRequest')).toEqual([
      'tokenMetadata',
      'economics',
      'auction',
    ]);
    expect(documentedTopLevelProperties('SharedRouteSolanaCreateLaunchRequest')).toEqual(
      expect.arrayContaining([
        'network',
        'tokenMetadata',
        'economics',
        'pairing',
        'pricing',
        'feeBeneficiaries',
        'governance',
        'migration',
        'auction',
      ]),
    );
    expect(documentedTopLevelProperties('DedicatedSolanaCreateLaunchRequest')).toEqual(
      expect.arrayContaining([
        'network',
        'tokenMetadata',
        'economics',
        'pairing',
        'pricing',
        'feeBeneficiaries',
        'governance',
        'migration',
        'auction',
      ]),
    );
    expect(documentedTopLevelProperties('SolanaEconomics')).toEqual(
      expect.arrayContaining(['totalSupply', 'baseForDistribution', 'baseForLiquidity']),
    );
    expect(documentedTopLevelProperties('SolanaAuction')).toEqual(
      expect.arrayContaining([
        'curveFeeBps',
        'swapFeeBps',
        'allowBuy',
        'allowSell',
        'cosignerGate',
        'dynamicFee',
      ]),
    );
  });

  it('documents complete create, status, and capabilities response contracts', () => {
    expect(documentedRequiredFields('CreateLaunchResponse')).toEqual([
      'launchId',
      'chainId',
      'txHash',
      'statusUrl',
      'predicted',
      'effectiveConfig',
    ]);
    expect(documentedRequiredFields('SolanaCreateLaunchResponse')).toEqual([
      'launchId',
      'network',
      'signature',
      'explorerUrl',
      'statusUrl',
      'predicted',
      'effectiveConfig',
    ]);
    expect(documentedRequiredFields('LaunchStatusResponse')).toEqual([
      'launchId',
      'chainId',
      'txHash',
      'status',
      'confirmations',
    ]);
    expect(documentedRequiredFields('CapabilitiesResponse')).toEqual([
      'defaultChainId',
      'pricing',
      'chains',
      'solana',
    ]);
    expect(readOpenApiSchemaBlock('CapabilitiesResponse')).toMatch(
      /defaultChainId:\n(?: {10}.*\n)*? {12}- type: 'null'/,
    );
    expect(documentedRequiredFields('ReadyResponse')).toEqual(['status', 'checks', 'solana']);
    expect(documentedRequiredFields('MetricsResponse')).toEqual(['startedAt', 'uptimeSec', 'http']);
    expect(documentedTopLevelProperties('CreateLaunchResponse')).toEqual(
      expect.arrayContaining([
        'launchId',
        'chainId',
        'txHash',
        'statusUrl',
        'predicted',
        'effectiveConfig',
      ]),
    );
    expect(documentedTopLevelProperties('LaunchStatusResponse')).toEqual(
      expect.arrayContaining([
        'launchId',
        'chainId',
        'txHash',
        'status',
        'confirmations',
        'result',
        'error',
      ]),
    );
  });

  it('has resolvable local component refs and route-specific response types', () => {
    const document = openApiDocument();
    const refs = Array.from(
      document.matchAll(/\$ref: '#\/components\/(schemas|responses|parameters)\/([^']+)'/g),
      (match) => ({ section: match[1], name: match[2] }),
    );

    for (const ref of refs) {
      expect(document, `missing OpenAPI ${ref.section} component ${ref.name}`).toContain(
        `    ${ref.name}:\n`,
      );
    }

    expect(document).toContain(
      '  /v1/launches:\n    post:\n      summary: Create an EVM launch through the shared route, or create a Solana launch',
    );
    expect(document).toMatch(
      /\/v1\/launches:[\s\S]*?'200':\n\s+\$ref: '#\/components\/responses\/CreateResponse'/,
    );
    expect(document).toMatch(
      /\/v1\/launches\/dynamic:[\s\S]*?'200':\n\s+\$ref: '#\/components\/responses\/EvmCreateResponse'/,
    );
    expect(document).toMatch(
      /\/v1\/solana\/launches:[\s\S]*?'200':\n\s+\$ref: '#\/components\/responses\/SolanaCreateResponse'/,
    );
  });

  it.each([
    '/v1/launches',
    '/v1/launches/static',
    '/v1/launches/multicurve',
    '/v1/launches/dynamic',
  ])('documents retryable pre-broadcast failures for %s', (path) => {
    expect(readOpenApiPathBlock(path)).toContain(
      "        '503':\n          $ref: '#/components/responses/Error'",
    );
  });

  it('keeps OpenAPI numeric-string constraints aligned with runtime validation', () => {
    const document = openApiDocument();
    expect(readOpenApiSchemaBlock('PositiveIntegerString')).toContain("pattern: '^[1-9]\\d*$'");
    expect(readOpenApiSchemaBlock('MaxShareWadString')).toContain(
      "pattern: '^(?:[1-9]\\d{0,17}|1000000000000000000)$'",
    );
    const vestingAllocation = readOpenApiSchemaBlock('VestingAllocation');
    expect(vestingAllocation).toContain("$ref: '#/components/schemas/PositiveIntegerString'");
    expect(vestingAllocation.match(/maximum: 4294967295/g)).toHaveLength(2);
    expect(vestingAllocation).toContain('Must not exceed durationSeconds.');
    expect(readOpenApiSchemaBlock('StaticCurveConfig')).toContain('maximum: 65535');
    expect(readOpenApiSchemaBlock('DynamicCurveConfig')).toContain('maximum: 8388607');
    expect(readOpenApiSchemaBlock('DynamicCurveConfig')).toContain('maximum: 15');
    expect(readOpenApiSchemaBlock('UniswapV4Migration')).toContain('maximum: 32767');
    expect(document).toContain("pattern: '^\\d+:0x[a-fA-F0-9]{64}$'");
    expect(document).toContain("pattern: '^\\d+(\\.\\d+)?$'");
  });

  it('distinguishes nonzero request addresses from native-compatible addresses', () => {
    const nonZeroAddress = readOpenApiSchemaBlock('NonZeroHexAddress');
    expect(nonZeroAddress).toContain("$ref: '#/components/schemas/HexAddress'");
    expect(nonZeroAddress).toContain("const: '0x0000000000000000000000000000000000000000'");
    expect(readOpenApiSchemaBlock('EvmStaticCreateLaunchRequest')).toContain(
      "$ref: '#/components/schemas/NonZeroHexAddress'",
    );
    expect(readOpenApiSchemaBlock('Pairing')).toContain("$ref: '#/components/schemas/HexAddress'");
    expect(openApiDocument()).not.toContain('/v1/top-ups');
    expect(openApiDocument()).not.toContain('CreateTopUp');
    expect(openApiDocument()).not.toContain('topUps:');
  });
});
