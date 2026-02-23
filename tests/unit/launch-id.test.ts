import { describe, expect, it } from 'vitest';

import { buildLaunchId, parseLaunchId } from '../../src/modules/launches/mapper';

describe('launchId mapping', () => {
  it('builds and parses launchId', () => {
    const launchId = buildLaunchId(
      84532,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(launchId).toBe(
      '84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    const parsed = parseLaunchId(launchId);
    expect(parsed.chainId).toBe(84532);
    expect(parsed.txHash).toBe(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });

  it('throws on invalid launchId', () => {
    expect(() => parseLaunchId('abc')).toThrow();
  });
});
