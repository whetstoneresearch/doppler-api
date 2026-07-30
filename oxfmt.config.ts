import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 100,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  arrowParens: 'always',
  overrides: [
    {
      files: ['README.md', 'AGENT_INTEGRATION.md', 'CHANGELOG.md', 'SECURITY.md', 'docs/**/*.md'],
      options: {
        proseWrap: 'never',
      },
    },
  ],
  sortPackageJson: false,
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    'coverage/**',
    '.test-results/**',
    'package-lock.json',
  ],
});
