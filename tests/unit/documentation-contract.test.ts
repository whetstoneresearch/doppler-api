import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/core/config';
import { createLaunchRequestSchema } from '../../src/modules/launches/schema';
import { genericSolanaCreateLaunchRequestSchema } from '../../src/modules/launches/solana-schema';
import { readOpenApiExample, readOpenApiPattern } from '../fixtures/openapi';

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

function openApiDocument(): string {
  return readFileSync(resolve(root, 'docs/openapi.yaml'), 'utf8');
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

  it('publishes exact canonical uint256 and proceeds patterns', () => {
    const uint256Pattern = new RegExp(readOpenApiPattern('PositiveUint256String'));
    const decimalPattern = new RegExp(readOpenApiPattern('Uint256Decimal18String'));
    const uint256Max = (2n ** 256n - 1n).toString();
    const uint256MaxProceeds =
      '115792089237316195423570985008687907853269984665640564039457.584007913129639935';
    const uint256ProceedsOverflow =
      '115792089237316195423570985008687907853269984665640564039457.584007913129639936';

    expect(uint256Pattern.test(uint256Max)).toBe(true);
    expect(uint256Pattern.test((2n ** 256n).toString())).toBe(false);
    expect(uint256Pattern.test('9'.repeat(78))).toBe(false);
    expect(uint256Pattern.test('01')).toBe(false);
    expect(uint256Pattern.test('0')).toBe(false);

    expect(decimalPattern.test('0')).toBe(true);
    expect(decimalPattern.test('1.000000000000000000')).toBe(true);
    expect(decimalPattern.test(uint256MaxProceeds)).toBe(true);
    expect(decimalPattern.test(uint256ProceedsOverflow)).toBe(false);
    expect(decimalPattern.test('1.0000000000000000000')).toBe(false);
    expect(decimalPattern.test('01')).toBe(false);
  });

  it.each(namedRpcEnvironments)(
    'resolves the .env.example with only $name configured',
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

  it('resolves every local OpenAPI component reference', () => {
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
  });
});
