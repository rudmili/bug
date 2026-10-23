import { StrictMode } from 'react'
// Fuentes servidas desde el propio sitio (solo el alfabeto latino): sin bloquear la carga en otro dominio
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { createDebugSession } from './debug/session'

// Modo sin conexión: sw.js solo existe en el build (vite.config.ts)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sin service worker la aplicación funciona igual, solo que necesita conexión
    })
  })
}

// App crea la sesión y le vuelve a ejecutar los comandos guardados; al reiniciar crea otra
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App createSession={createDebugSession} />
    </ErrorBoundary>
  </StrictMode>,
)
