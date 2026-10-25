// First, before any store reads the save: a fixture session works on a copy. @see fixture-sandbox
import './fixture-sandbox'
// `?hitches`, in development: every timer and frame callback timed, by where it came from. @see hitches
import { installHitches } from './hitches'
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('hitches')) installHitches()
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// The console's tokens, before anything is drawn. @see installTheme
import { installTheme } from './ui/theme/install'
installTheme()
import App from './App.tsx'

const isWorldV2 = new URLSearchParams(window.location.search).get('world') === '1'

const mount = (node: ReactNode) =>
  createRoot(document.getElementById('root')!).render(<StrictMode>{node}</StrictMode>)

// The editor's route is loaded with `.then` rather than a top-level `await`,
// which is what it used to use. TLA is not in the build's target — es2021,
// chrome105, safari15 — so esbuild refused to transpile the entry and `npm run
// build` failed on it, while `vite dev` was perfectly happy because dev serves
// modules untranspiled. Nothing here needs to block the module's evaluation:
// the import's only job is to hand back a component to mount.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('uikit')) {
  // The console's kit on its own: every piece, both themes, any stage. @see KitGallery
  void import('./ui/console/gallery.tsx').then(({ KitGallery }) => mount(<KitGallery />))
} else if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('questkit')) {
  // The AI's console kit on its own, light and dark. @see QuestGallery
  void import('./quest-ui/gallery.tsx').then(({ QuestGallery }) => mount(<QuestGallery />))
} else if (isWorldV2) {
  // The world editor, a separate route. A dynamic import keeps it out of
  // the game's bundle.
  void import('./world/world-editor.tsx').then(({ WorldEditor }) => mount(<WorldEditor />))
} else if (new URLSearchParams(window.location.search).has('fixture')) {
  // A fixture opened in the game: its company, seeded in the copy. @see seedFixtureCompany
  void import('./world/debug/fixture-company.ts').then(({ seedFixtureCompany }) => {
    seedFixtureCompany()
    mount(<App />)
  })
} else {
  mount(<App />)
}
