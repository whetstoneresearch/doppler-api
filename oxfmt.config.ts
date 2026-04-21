import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 100,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  arrowParens: 'always',
  sortPackageJson: false,
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    'coverage/**',
    '.test-results/**',
    'package-lock.json',
  ],
});
