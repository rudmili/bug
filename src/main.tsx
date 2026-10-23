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
import { createWorkerClient } from './ui/client'
import { sharedProgram } from './ui/share'
import { useCommandLog } from './ui/store'

// Modo sin conexión: sw.js solo existe en el build (vite.config.ts)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sin service worker la aplicación funciona igual, solo que necesita conexión
    })
  })
}

// La sesión corre en un worker, creado una sola vez fuera de React (StrictMode monta App dos veces)
const client = createWorkerClient()

// Programa compartido en el enlace (#p=…): sin nada guardado se abre directamente; si hay una sesión,
// App pregunta antes de reemplazarla. El hash se quita para que recargar no lo vuelva a abrir.
const shared = sharedProgram(location.hash)
if (shared) history.replaceState(null, '', location.pathname + location.search)
const store = useCommandLog.getState()
const pendingShared = shared && store.log.length > 0 ? shared : null
if (shared && !pendingShared) store.load(shared)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App client={client} shared={pendingShared} />
    </ErrorBoundary>
  </StrictMode>,
)
