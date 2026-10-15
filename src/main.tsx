import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { createDebugSession } from './debug/session'

// App crea la sesión y le vuelve a ejecutar los comandos guardados; al reiniciar crea otra
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App createSession={createDebugSession} />
  </StrictMode>,
)
