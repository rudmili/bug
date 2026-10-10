import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { createMockSession } from './debug/mock'

// Se crea una sola vez, fuera del render: StrictMode y el React Compiler pueden renderizar dos veces
const session = createMockSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
)
