import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/** Directories moved onto the console's tokens. @see plans/ui-overhaul.md §7 */
const MIGRATED = ['src/ui/console/**', 'src/ui/comms/**', 'src/quest-ui/**', 'src/world/play/event-cards.tsx', 'src/world/play/hint-card.tsx',
  // U5, the HUD.
  'src/molecules/toolbar.tsx', 'src/ui/ResourceCounter.tsx', 'src/molecules/ai-singularity-readout.tsx', 'src/molecules/company-timer.tsx',
  'src/molecules/founder-badge.tsx', 'src/molecules/game-stage-ticker.tsx', 'src/molecules/innovation-counter.tsx', 'src/molecules/valuation-counter.tsx',
  // U6, the map's edges.
  'src/world/play/build-bar.tsx', 'src/world/play/ai-mode-panel.tsx', 'src/world/play/wonders-panel.tsx', 'src/world/play/main-card.tsx',
  'src/world/play/projects-panel.tsx', 'src/world/play/top-streets.tsx', 'src/world/play/desire-readout.tsx', 'src/world/play/port-income.tsx',
  'src/world/play/gate-chips.tsx', 'src/world/play/leader-tags.tsx', 'src/world/play/building-labels.tsx', 'src/world/play/anchored.tsx',
  'src/world/play/company-map.tsx', 'src/molecules/employee-satisfaction-overlay.tsx',
  // U7, the sidebar.
  'src/molecules/sidebar.tsx', 'src/molecules/generators.tsx', 'src/molecules/upgrades.tsx', 'src/molecules/generator-buy-button.tsx',
  'src/molecules/purchase-mode-toggle.tsx', 'src/molecules/agents-row.tsx', 'src/molecules/ai-tab.tsx', 'src/molecules/acquisition-tab.tsx',
  'src/molecules/valuation-tab.tsx', 'src/molecules/valuation-summary.tsx', 'src/molecules/achievements-tab.tsx', 'src/molecules/innovation/**',
  'src/world/play/datacentre-panel.tsx', 'src/ui/InfoRow.tsx', 'src/ui/ModifierTag.tsx', 'src/ui/BonusRow.tsx', 'src/ui/ProgressBar.tsx',
  'src/ui/InfoPop.tsx', 'src/ui/CyclingButton.tsx', 'src/ui/Popover.tsx',
  // U8, dialogs and flows.
  'src/molecules/founder-select.tsx', 'src/molecules/founding-shell.tsx', 'src/molecules/term-sheet-select.tsx', 'src/world/play/map-setup.tsx',
  'src/molecules/model-shop.tsx', 'src/molecules/fused-traits.tsx', 'src/molecules/offline-summary.tsx', 'src/molecules/ascension-card.tsx',
  'src/molecules/settings-popover.tsx', 'src/molecules/sound-controls.tsx', 'src/molecules/sell-transition.tsx',
  // U9, the skill tree.
  'src/molecules/skill-tree/**',
  // U10, the phone.
  'src/App.tsx']
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
      'no-restricted-imports': ['error', {
        paths: [{ name: 'motion', message: 'Use the kit in src/ui, not arwes directly.' }],
        patterns: [{ group: ['@arwes/*'], message: 'Use the kit in src/ui, not arwes directly.' }],
      }],
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
