import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // A leading underscore says "unused on purpose".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // ARWES only through the quest UI: themed by QuestFrame, and in its lazy chunk. @see src/quest-ui
      'no-restricted-imports': ['error', { patterns: [{ group: ['@arwes/*', 'motion'], message: 'Use src/quest-ui (loaded through loadQuestUi), not arwes directly.' }] }],
    },
  },
  {
    // The quest UI itself, and the 10x dev's decipher, which came first.
    files: ['src/quest-ui/**', 'src/utils/ten-x-utils.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
)
