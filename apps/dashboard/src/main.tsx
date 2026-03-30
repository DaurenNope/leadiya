import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { ExtensionStatusProvider } from './context/ExtensionStatusContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { TenantProvider } from './context/TenantContext.tsx'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Missing #root element')
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <TenantProvider>
          <ToastProvider>
            <ExtensionStatusProvider>
              <App />
            </ExtensionStatusProvider>
          </ToastProvider>
        </TenantProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
