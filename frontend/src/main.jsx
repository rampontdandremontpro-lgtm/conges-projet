import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/tokens.css'
import './styles/base.css'
import './styles/components/badges.css'
import './styles/layout/shell.css'
import './styles/shared/02-figma-motion-enhancements.css'

import App from './app/App.jsx'

// Couche responsive globale chargée après les styles des pages.
import './styles/layout/05-responsive-app.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
