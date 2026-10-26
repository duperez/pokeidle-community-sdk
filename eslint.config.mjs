import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.generated.ts'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      // `let timer;` read by a cleanup closure before the single assignment is a pattern, not an oversight.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      // The runner follows the promise `test()` returns, so it is safe; any other forgotten `await` is still an error.
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'it', 'describe'] }] },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // `import { type A } from './x'` with only types would still load './x'; `import type` does not.
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Tests may silence the console while they provoke an error on purpose.
  { files: ['**/test/**/*.ts'], rules: { 'no-console': 'off' } },
  // Scripts and repository-level tests are plain Node modules: no type information.
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: { eqeqeq: ['error', 'always'] },
  },
  prettier,
);
