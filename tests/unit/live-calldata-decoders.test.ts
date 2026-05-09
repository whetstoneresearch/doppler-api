import { describe, expect, it } from 'vitest';
import { encodeAbiParameters } from 'viem';

import {
  decodeRehypeInitCalldata,
  decodeStandardTokenFactoryData,
} from '../live/helpers/calldata-decoders';

const recipientA = '0x1111111111111111111111111111111111111111';
const recipientB = '0x2222222222222222222222222222222222222222';
const numeraire = '0x3333333333333333333333333333333333333333';
const buybackDst = '0x000000000000000000000000000000000000dEaD';

describe('live calldata decoders', () => {
  it('decodes legacy standard token factory data', () => {
    const encoded = encodeAbiParameters(
      [
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'yearlyMintRate', type: 'uint256' },
        { name: 'vestingDuration', type: 'uint256' },
        { name: 'recipients', type: 'address[]' },
        { name: 'amounts', type: 'uint256[]' },
        { name: 'tokenURI', type: 'string' },
      ],
      ['Legacy Token', 'LEG', 384n, 7_776_000n, [recipientA], [100n], 'ipfs://legacy'],
    );

    const decoded = decodeStandardTokenFactoryData(encoded);

    expect(decoded.kind).toBe('legacy');
    expect(decoded.yearlyMintRate).toBe(384n);
    expect(decoded.recipients).toEqual([recipientA]);
    expect(decoded.amounts).toEqual([100n]);
    if (decoded.kind === 'legacy') {
      expect(decoded.vestingDuration).toBe(7_776_000n);
    }
  });

  it('decodes DERC20 V2 schedule token factory data', () => {
    const encoded = encodeAbiParameters(
      [
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'yearlyMintRate', type: 'uint256' },
        {
          name: 'schedules',
          type: 'tuple[]',
          components: [
            { name: 'cliff', type: 'uint64' },
            { name: 'duration', type: 'uint64' },
          ],
        },
        { name: 'beneficiaries', type: 'address[]' },
        { name: 'scheduleIds', type: 'uint256[]' },
        { name: 'amounts', type: 'uint256[]' },
        { name: 'tokenURI', type: 'string' },
      ],
      [
        'V2 Token',
        'V2T',
        384n,
        [{ cliff: 1_000n, duration: 24_624_000n }],
        [recipientA, recipientB],
        [0n, 0n],
        [100n, 200n],
        'ipfs://v2',
      ],
    );

    const decoded = decodeStandardTokenFactoryData(encoded);

    expect(decoded.kind).toBe('v2');
    expect(decoded.yearlyMintRate).toBe(384n);
    expect(decoded.recipients).toEqual([recipientA, recipientB]);
    expect(decoded.amounts).toEqual([100n, 200n]);
    if (decoded.kind === 'v2') {
      expect(decoded.scheduleIds).toEqual([0n, 0n]);
      expect(decoded.schedules).toEqual([{ cliff: 1_000n, duration: 24_624_000n }]);
    }
  });

  it('decodes Rehype tuple init calldata', () => {
    const encoded = encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
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
              components: [
                { name: 'assetFeesToAssetBuybackWad', type: 'uint256' },
                { name: 'assetFeesToNumeraireBuybackWad', type: 'uint256' },
                { name: 'assetFeesToBeneficiaryWad', type: 'uint256' },
                { name: 'assetFeesToLpWad', type: 'uint256' },
                { name: 'numeraireFeesToAssetBuybackWad', type: 'uint256' },
                { name: 'numeraireFeesToNumeraireBuybackWad', type: 'uint256' },
                { name: 'numeraireFeesToBeneficiaryWad', type: 'uint256' },
                { name: 'numeraireFeesToLpWad', type: 'uint256' },
              ],
            },
          ],
        },
      ],
      [
        {
          numeraire,
          buybackDst,
          startFee: 5_011,
          endFee: 5_011,
          durationSeconds: 0,
          startingTime: 0,
          feeRoutingMode: 0,
          feeDistributionInfo: {
            assetFeesToAssetBuybackWad: 1_000_000_000_000_000_000n,
            assetFeesToNumeraireBuybackWad: 0n,
            assetFeesToBeneficiaryWad: 0n,
            assetFeesToLpWad: 0n,
            numeraireFeesToAssetBuybackWad: 1_000_000_000_000_000_000n,
            numeraireFeesToNumeraireBuybackWad: 0n,
            numeraireFeesToBeneficiaryWad: 0n,
            numeraireFeesToLpWad: 0n,
          },
        },
      ],
    );

    const decoded = decodeRehypeInitCalldata(encoded);

    expect(decoded.numeraire).toBe(numeraire);
    expect(decoded.buybackDst).toBe(buybackDst);
    expect(decoded.startFee).toBe(5_011);
    expect(decoded.endFee).toBe(5_011);
    expect(decoded.feeDistributionInfo.assetFeesToAssetBuybackWad).toBe(1_000_000_000_000_000_000n);
    expect(decoded.feeDistributionInfo.numeraireFeesToAssetBuybackWad).toBe(
      1_000_000_000_000_000_000n,
    );
  });
});
