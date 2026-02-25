import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Track if we're in the middle of an update
let isUpdating = false

// Only register service worker in production
// In development, skip registration to avoid caching issues
if (import.meta.env.PROD) {
  // Register service worker with auto-update and reload
  // Wrapped in try-catch to handle Cloudflare Access blocking sw.js
  try {
    const updateSW = registerSW({
    onNeedRefresh() {
      if (isUpdating) return
      isUpdating = true
      
      console.log('[PWA] New content available, updating...')
      showUpdateToast('Updating...', 1500)
      updateSW(true)
      
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    },
    onOfflineReady() {
      console.log('[PWA] App ready for offline use')
    },
    onRegistered(registration) {
      console.log('[PWA] Service worker registered')
      if (registration) {
        setInterval(() => {
          registration.update().catch(() => {})
        }, 60 * 1000)
        
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {})
          }
        })
      }
    },
    onRegisterError(error: unknown) {
      // Suppress error logging - expected behind Cloudflare Access
      const message = error instanceof Error ? error.message : String(error)
      console.debug('[PWA] Service worker registration unavailable:', message)
    },
  })

    // Expose manual update check
    ;(window as Window & { __checkForUpdates?: () => Promise<void> }).__checkForUpdates = async () => {
      const registration = await navigator.serviceWorker?.getRegistration()
      if (registration) {
        showUpdateToast('Checking for updates...', 2000)
        await registration.update()
        setTimeout(() => {
          if (!isUpdating) {
            showUpdateToast('Already on latest version ✓', 2000)
          }
        }, 2000)
      }
    }
  } catch {
    console.debug('[PWA] Service worker not available')
  }
} else {
  console.log('[PWA] Service worker disabled in development mode')
  
  // Provide dev-mode fallbacks for global functions
  ;(window as Window & { __checkForUpdates?: () => void }).__checkForUpdates = () => {
    showUpdateToast('Service worker disabled in development mode', 2000)
  }
}

// Simple toast function for update notifications
function showUpdateToast(message: string, duration: number = 3000) {
  const existing = document.getElementById('pwa-update-toast')
  if (existing) existing.remove()
  
  const toast = document.createElement('div')
  toast.id = 'pwa-update-toast'
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #c9a0dc;
    color: #0d1117;
    padding: 12px 24px;
    border-radius: 8px;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideUp 0.3s ease-out;
  `
  
  if (!document.getElementById('pwa-toast-styles')) {
    const style = document.createElement('style')
    style.id = 'pwa-toast-styles'
    style.textContent = `
      @keyframes slideUp {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `
    document.head.appendChild(style)
  }
  
  document.body.appendChild(toast)
  
  if (duration > 0) {
    setTimeout(() => toast.remove(), duration)
  }
}

// Force refresh - clears all caches and reloads
;(window as Window & { __forceRefresh?: () => Promise<void> }).__forceRefresh = async () => {
  if (import.meta.env.DEV) {
    showUpdateToast('Development mode - performing simple refresh...', 1000)
    setTimeout(() => {
      window.location.reload()
    }, 500)
    return
  }
  
  showUpdateToast('Clearing cache...', 0)
  
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations()
    for (const registration of registrations || []) {
      await registration.unregister()
    }
    
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map(name => caches.delete(name)))
    
    showUpdateToast('Reloading...', 1000)
    
    setTimeout(() => {
      window.location.reload()
    }, 500)
  } catch (err) {
    console.error('Force refresh failed:', err)
    showUpdateToast('Refresh failed, try manual reload', 3000)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
