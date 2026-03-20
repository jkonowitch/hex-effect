import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '.svelte-kit/**',
      'build/**',
      'dist/**',
      'node_modules/**',
      '.DS_Store',
      '/build',
      '/.svelte-kit',
      '/package',
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock'
    ]
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
        ecmaVersion: 2020
      },
      globals: {
        ...globals.browser,
        ...globals.es2017,
        ...globals.node
      }
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules
    }
  },
  ...sveltePlugin.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser
      },
      globals: {
        ...globals.browser,
        ...globals.es2017,
        ...globals.node
      }
    }
  },
  prettier,
  {
    rules: {
      'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }]
    }
  }
];

// svelte/no-navigation-without-resolve looks for `resolve` from '$app/paths',
// but SvelteKit 2 exports `resolveRoute` instead — the rule's API check is stale.
// Disable link checking until eslint-plugin-svelte aligns with SvelteKit 2's API.
