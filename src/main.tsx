import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const isDebugMap = new URLSearchParams(window.location.search).get('debug') === 'map'

const isWorldV2 = new URLSearchParams(window.location.search).get('world') === '1'

if (isDebugMap) {
  const { MapHarness } = await import('./debug/map-harness.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MapHarness />
    </StrictMode>,
  )
} else if (isWorldV2) {
  // v2 world engine — a third, fully separate route. Dynamic import keeps it
  // out of the production bundle until it is wired in.
  const { WorldEditor } = await import('./world/world-editor.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WorldEditor />
    </StrictMode>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
