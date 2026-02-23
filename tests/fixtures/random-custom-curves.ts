const WAD = 10n ** 18n;
const BPS_DENOMINATOR = 10_000;
const WAD_PER_BPS = WAD / BigInt(BPS_DENOMINATOR); // 1e14
const MIN_START_MARKET_CAP_USD = 2;
const MAX_START_MARKET_CAP_USD = 999_999;

export interface RandomCurveInput {
  marketCapStartUsd: number;
  marketCapEndUsd: number;
  numPositions: number;
  sharesWad: string;
}

export interface RandomCustomCurvePlan {
  curves: RandomCurveInput[];
  shareBps: number[];
}

const randomInt = (minInclusive: number, maxInclusive: number): number =>
  minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1));

const pickCurveCount = (): 3 | 4 => (Math.random() < 0.5 ? 3 : 4);

const pickBreakpoints = (curveCount: 3 | 4, maxMarketCapUsd: number): number[] => {
  if (maxMarketCapUsd <= MAX_START_MARKET_CAP_USD) {
    throw new Error(`maxMarketCapUsd must be greater than ${MAX_START_MARKET_CAP_USD}`);
  }

  const first = randomInt(MIN_START_MARKET_CAP_USD, 100_000);
  const second = randomInt(first + 100, 350_000);
  const thirdUpperBound = curveCount === 3 ? MAX_START_MARKET_CAP_USD : 750_000;
  const third = randomInt(second + 100, thirdUpperBound);

  if (curveCount === 3) {
    return [first, second, third, maxMarketCapUsd];
  }

  const fourth = randomInt(third + 100, MAX_START_MARKET_CAP_USD);
  return [first, second, third, fourth, maxMarketCapUsd];
};

const randomShareBps = (curveCount: number): number[] => {
  const minPerCurveBps = 500; // 5.00%
  const shares: number[] = [];
  let remaining = BPS_DENOMINATOR;

  for (let i = 0; i < curveCount - 1; i += 1) {
    const remainingSlots = curveCount - i - 1;
    const max = remaining - remainingSlots * minPerCurveBps;
    const next = randomInt(minPerCurveBps, max);
    shares.push(next);
    remaining -= next;
  }

  shares.push(remaining);
  return shares;
};

export const buildRandomCustomCurvePlan = (maxMarketCapUsd: number): RandomCustomCurvePlan => {
  const curveCount = pickCurveCount();
  const breakpoints = pickBreakpoints(curveCount, maxMarketCapUsd);
  const shareBps = randomShareBps(curveCount);

  const curves = shareBps.map((bps, index) => ({
    marketCapStartUsd: breakpoints[index],
    marketCapEndUsd: breakpoints[index + 1],
    numPositions: randomInt(9, 13),
    sharesWad: (BigInt(bps) * WAD_PER_BPS).toString(),
  }));

  return { curves, shareBps };
};
