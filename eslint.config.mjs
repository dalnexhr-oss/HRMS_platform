import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: fileURLToPath(new URL('.', import.meta.url)),
});

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals'),
  {
    rules: {
      curly: ['error', 'all'],
      'import/first': 'error',
      'import/newline-after-import': 'error',
    },
  },
  {
    // App Router's root layout loads these fonts for every page.
    files: ['src/app/layout.tsx'],
    rules: { '@next/next/no-page-custom-font': 'off' },
  },
];

export default config;
