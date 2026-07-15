import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, createConfig, WagmiProvider } from 'wagmi'
import { monadTestnet } from 'wagmi/chains'

import App from './App.tsx'
import './index.css'

declare global {
  interface Window { __PARA_API_KEY__?: string }
}

const PARA_API_KEY = import.meta.env.VITE_PARA_API_KEY || (typeof window !== 'undefined' ? window.__PARA_API_KEY__ || '' : '')
const MONAD_TESTNET_RPC = import.meta.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

const wagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(MONAD_TESTNET_RPC),
  },
  multiInjectedProviderDiscovery: true,
})

// Core app tree — providers in correct nesting order
function AppTree() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

// Para wrapper — loads async, wraps app tree when ready
function ParaWrapper({ children }: { children: React.ReactNode }) {
  const [ParaComponent, setParaComponent] = useState<React.ComponentType<{ children: React.ReactNode }> | null>(null)

  useEffect(() => {
    if (!PARA_API_KEY) return
    let cancelled = false
    import('@getpara/react-sdk')
      .then(({ ParaProvider, Environment }) => {
        if (cancelled) return
        const Wrapper = ({ children }: { children: React.ReactNode }) => (
          <ParaProvider
            paraClientConfig={{ apiKey: PARA_API_KEY, env: Environment.BETA }}
            config={{ appName: 'Vouch' }}
            paraModalConfig={{
              oAuthMethods: ['GOOGLE', 'TWITTER', 'APPLE'],
              disablePhoneLogin: false,
              recoverySecretStepEnabled: true,
            }}
            externalWalletConfig={{
              evmConnector: {
                config: {
                  chains: [monadTestnet],
                  transports: { [monadTestnet.id]: http(MONAD_TESTNET_RPC) },
                },
              },
              wallets: ['METAMASK', 'COINBASE', 'WALLETCONNECT'],
            }}
          >
            {children}
          </ParaProvider>
        )
        setParaComponent(() => Wrapper)
        console.info('[vouch] Para SDK loaded')
      })
      .catch((err) => {
        console.warn('[vouch] Para SDK failed:', err)
      })
    return () => { cancelled = true }
  }, [])

  // Always render children immediately. Para wraps when ready.
  if (ParaComponent) {
    return <ParaComponent>{children}</ParaComponent>
  }
  return <>{children}</>
}

// Render — QueryClientProvider is OUTERMOST, always available
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ParaWrapper>
        <AppTree />
      </ParaWrapper>
    </QueryClientProvider>
  </StrictMode>,
)
