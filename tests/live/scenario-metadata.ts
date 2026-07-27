export const EVM_LIVE_SCENARIO_GROUPS = {
  staticCustomFee: ['static', 'fees'],
  staticPreset: ['static'],
  staticRange: ['static'],
  staticVesting: ['static'],
  staticGovernance: ['static', 'governance'],
  dynamicCustomFee: ['dynamic', 'fees'],
  dynamicHookBeneficiaries: ['dynamic', 'fees', 'uniswap-v4'],
  dynamicUniswapV2: ['dynamic', 'uniswap-v2'],
  dynamicUniswapV4: ['dynamic', 'uniswap-v4'],
  dynamicRehypeUniswapV4: ['dynamic', 'uniswap-v4'],
  dynamicRange: ['dynamic'],
  dynamicVesting: ['dynamic'],
  dynamicGovernance: ['dynamic', 'governance'],
  multicurveLowDefault: ['multicurve', 'multicurve-defaults'],
  multicurveMediumDefault: ['multicurve', 'multicurve-defaults'],
  multicurveHighDefault: ['multicurve', 'multicurve-defaults'],
  multicurveCustomFee: ['multicurve', 'fees'],
  multicurveDefaultVesting: ['multicurve'],
  multicurveExplicitVesting: ['multicurve'],
  multicurveMultipleVesting: ['multicurve'],
  multicurveCustomCurve: ['multicurve'],
  multicurveRandomCurveAndVesting: ['multicurve'],
  multicurveRehype: ['multicurve'],
  multicurveGovernance: ['multicurve', 'governance'],
} as const;

export type EvmLiveScenarioGroup =
  (typeof EVM_LIVE_SCENARIO_GROUPS)[keyof typeof EVM_LIVE_SCENARIO_GROUPS][number];

export const countEvmLiveScenarios = (filter: string): number => {
  const normalized = filter.trim().toLowerCase();
  const scenarios = Object.values(EVM_LIVE_SCENARIO_GROUPS);
  if (normalized === 'all') {
    return scenarios.length;
  }
  if (normalized === 'multicurve') {
    return scenarios.filter((groups) => (groups as readonly string[]).includes('multicurve'))
      .length;
  }
  if (normalized === 'negative') {
    return 0;
  }
  const count = scenarios.filter((groups) =>
    (groups as readonly string[]).includes(normalized),
  ).length;
  return count === 0 ? scenarios.length : count;
};
