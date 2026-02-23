export const SUITE_DEFS = [
  {
    id: 'unit',
    title: 'Unit',
    description: 'Logic, schema defaults, and pure mapping behavior',
    patterns: ['tests/unit'],
    defaultSelected: true,
  },
  {
    id: 'integration',
    title: 'Integration',
    description: 'HTTP routes, policies, and service wiring with test server',
    patterns: ['tests/integration'],
    defaultSelected: true,
  },
  {
    id: 'live',
    title: 'Live',
    description: 'Onchain launch verification against configured network',
    patterns: ['tests/live'],
    defaultSelected: false,
  },
];
