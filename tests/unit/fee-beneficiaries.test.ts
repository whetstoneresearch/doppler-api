import { describe, expect, it } from 'vitest';
import { WAD } from '@whetstone-research/doppler-sdk';

import { normalizeFeeBeneficiaries } from '../../src/modules/auctions/multicurve/mapper';
import type { CreateLaunchRequestInput } from '../../src/modules/launches/schema';

const baseInput: CreateLaunchRequestInput = {
  userAddress: '0x1111111111111111111111111111111111111111',
  tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://meta' },
  tokenomics: { totalSupply: '1000000000000000000' },
  governance: { enabled: false, mode: 'noOp' },
  migration: { type: 'noOp' },
  auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
};

describe('fee beneficiary defaults', () => {
  it('defaults to 95/5 split when beneficiaries omitted', async () => {
    const result = await normalizeFeeBeneficiaries({
      input: baseInput,
      protocolOwner: '0x2222222222222222222222222222222222222222',
    });

    expect(result.source).toBe('default');
    expect(result.beneficiaries).toHaveLength(2);
    expect(result.beneficiaries[0]?.shares + result.beneficiaries[1]?.shares).toBe(WAD);
  });

  it('validates explicit shares sum to WAD', async () => {
    await expect(
      normalizeFeeBeneficiaries({
        input: {
          ...baseInput,
          feeBeneficiaries: [
            { address: '0x1111111111111111111111111111111111111111', sharesWad: '1' },
          ],
        },
        protocolOwner: '0x2222222222222222222222222222222222222222',
      }),
    ).rejects.toThrow(/sum/);
  });
});
