import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { ExtensionStatusProvider } from './context/ExtensionStatusContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { TenantProvider } from './context/TenantContext.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <TenantProvider>
        <ToastProvider>
          <ExtensionStatusProvider>
            <App />
          </ExtensionStatusProvider>
        </ToastProvider>
      </TenantProvider>
    </AuthProvider>
  </React.StrictMode>,
)
