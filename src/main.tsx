import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Framer Motion animations run in JS and ignore the CSS
        prefers-reduced-motion rule in index.css — this is the framer-native
        equivalent, so vestibular-safe users get it for every motion.* too. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
