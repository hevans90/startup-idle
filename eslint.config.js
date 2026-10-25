import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/** Directories moved onto the console's tokens. @see plans/ui-overhaul.md §7 */
const MIGRATED = ['src/ui/console/**', 'src/quest-ui/**']
/** A Tailwind colour class from the raw palette: text-violet-600, dark:bg-primary-900, border-emerald-400/50… */
const RAW_PALETTE = '/(^|[\\s:])(text|bg|border|fill|stroke|ring|outline|from|to|via|accent|divide)-(primary|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d/'

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
      // ARWES only through the console's kit, themed from its tokens. @see src/ui, plans/ui-overhaul.md §2
      'no-restricted-imports': ['error', { patterns: [{ group: ['@arwes/*', 'motion'], message: 'Use the kit in src/ui, not arwes directly.' }] }],
    },
  },
  {
    // The kit itself, and the 10x dev's decipher, which came first.
    files: ['src/ui/**', 'src/utils/ten-x-utils.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // MIGRATED TO THE CONSOLE: colours by role, from the tokens — no raw palette class, which would need its
    // own dark: pair and would not follow the takeover. The list grows a phase at a time. @see plans/ui-overhaul.md §2
    files: MIGRATED,
    ignores: ['src/quest-ui/gallery.tsx'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: `Literal[value=${RAW_PALETTE}]`, message: 'Use the console tokens (bg-surface-1, text-fg-muted, text-money…), not a raw palette class.' },
        { selector: `TemplateElement[value.raw=${RAW_PALETTE}]`, message: 'Use the console tokens (bg-surface-1, text-fg-muted, text-money…), not a raw palette class.' },
      ],
    },
  },
)
