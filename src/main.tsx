import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
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
if (isWorldV2) {
  // The world editor, a separate route. A dynamic import keeps it out of
  // the game's bundle.
  void import('./world/world-editor.tsx').then(({ WorldEditor }) => mount(<WorldEditor />))
} else {
  mount(<App />)
}
