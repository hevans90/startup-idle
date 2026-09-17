import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const isDebugMap = new URLSearchParams(window.location.search).get('debug') === 'map'

if (isDebugMap) {
  const { MapHarness } = await import('./debug/map-harness.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MapHarness />
    </StrictMode>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
