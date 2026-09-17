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
      'no-var': 'error',
      'prefer-const': 'error',
      'one-var': ['error', 'never'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'arrow-body-style': ['error', 'as-needed'],
      'spaced-comment': [
        'error',
        'always',
        { line: { markers: ['/'] }, block: { balanced: true } },
      ],
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
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      // Check local names while leaving database fields and external object keys intact.
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'variable', modifiers: ['destructured'], format: null },
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        { selector: 'parameter', modifiers: ['destructured'], format: null },
        {
          selector: 'parameter',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
      ],
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
