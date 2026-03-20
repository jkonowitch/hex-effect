import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.svelte-kit/**', '**/build/**']
  },
  {
    files: ['**/*.{js,ts}'],
    plugins: {
      '@typescript-eslint': typescriptEslint
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022
      },
      globals: {
        ...globals.es2022,
        ...globals.node
      }
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules
    }
  },
  prettier
];
