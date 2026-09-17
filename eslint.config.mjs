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
  ...compat.plugins('@typescript-eslint'),
  {
    rules: {
      curly: ['error', 'all'],
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'import/no-duplicates': ['error', { 'prefer-inline': false }],
      'import/order': [
        'error',
        {
          groups: [
            ['builtin', 'external', 'internal', 'unknown', 'parent', 'sibling', 'index', 'object'],
            'type',
          ],
          'newlines-between': 'never',
          warnOnUnassignedImports: true,
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
    },
  },
  {
    // App Router's root layout loads these fonts for every page.
    files: ['src/app/layout.tsx'],
    rules: { '@next/next/no-page-custom-font': 'off' },
  },
];

export default config;
