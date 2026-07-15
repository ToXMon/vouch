import { StrictMode, useState, useEffect, type ReactElement } from 'react'
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

// Synchronous inner app — ALWAYS renders immediately with wagmi
function InnerApp() {
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

// Para wrapper — loads async, upgrades the tree when ready
function ParaWrapper({ children }: { children: React.ReactNode }) {
  const [ParaComponent, setParaComponent] = useState<React.ComponentType<{ children: React.ReactNode }> | null>(null)
  const [paraFailed, setParaFailed] = useState(false)

  useEffect(() => {
    if (!PARA_API_KEY) return

    let cancelled = false

    import('@getpara/react-sdk')
      .then(({ ParaProvider, Environment }) => {
        if (cancelled) return

        // Create a wrapper component that applies ParaProvider
        const Wrapper = ({ children }: { children: React.ReactNode }) => (
          <ParaProvider
            paraClientConfig={{
              apiKey: PARA_API_KEY,
              env: Environment.BETA,
            }}
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
                  transports: {
                    [monadTestnet.id]: http(MONAD_TESTNET_RPC),
                  },
                },
              },
              wallets: ['METAMASK', 'COINBASE', 'WALLETCONNECT'],
            }}
          >
            {children}
          </ParaProvider>
        )

        setParaComponent(() => Wrapper)
        console.info('[vouch] Para SDK loaded — embedded wallets available')
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[vouch] Para SDK failed to load — using wagmi only:', err)
        setParaFailed(true)
      })

    return () => { cancelled = true }
  }, [])

  // No Para key or Para failed — render wagmi-only tree directly
  if (!PARA_API_KEY || paraFailed) {
    return <>{children}</>
  }

  // Para loaded — wrap children with ParaProvider
  if (ParaComponent) {
    return <ParaComponent>{children}</ParaComponent>
  }

  // Para loading — render wagmi-only tree immediately (no blank screen)
  return <>{children}</>
}

// Render IMMEDIATELY with wagmi — no async, no blank screen
const rootElement = document.getElementById('root')!
const root = createRoot(rootElement)

root.render(
  <StrictMode>
    <ParaWrapper>
      <InnerApp />
    </ParaWrapper>
  </StrictMode>,
)
