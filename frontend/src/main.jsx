import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import logoGmes from '@/assets/logo-gmes.png'

import './styles/tokens.css'
import './styles/base.css'
import './styles/components/badges.css'
import './styles/layout/shell.css'
import './styles/shared/02-figma-motion-enhancements.css'

import App from './app/App.jsx'

// Couche responsive globale chargée après les styles des pages.
import './styles/layout/05-responsive-app.css'

document.title = 'G Congés & Absences'
const favicon = document.querySelector('link[rel~="icon"]') ?? document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/png'
favicon.href = `${logoGmes}?v=20260826-2`
if (!favicon.parentNode) document.head.appendChild(favicon)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
