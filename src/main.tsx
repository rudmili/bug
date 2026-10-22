import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { createDebugSession } from './debug/session'

// App crea la sesión y le vuelve a ejecutar los comandos guardados; al reiniciar crea otra
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App createSession={createDebugSession} />
    </ErrorBoundary>
  </StrictMode>,
)
