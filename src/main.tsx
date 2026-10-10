import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { createDebugSession } from './debug/session'

// Se crea una sola vez, fuera del render: StrictMode y el React Compiler pueden renderizar dos veces
const session = createDebugSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
)
