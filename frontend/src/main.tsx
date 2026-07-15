import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, createConfig, WagmiProvider } from 'wagmi'
import { monadTestnet } from 'wagmi/chains'

import App from './App.tsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

declare global {
  interface Window { __PARA_API_KEY__?: string }
}

const PARA_API_KEY = import.meta.env.VITE_PARA_API_KEY || (typeof window !== 'undefined' ? window.__PARA_API_KEY__ || '' : '')
const MONAD_TESTNET_RPC = import.meta.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'

const wagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(MONAD_TESTNET_RPC),
  },
  multiInjectedProviderDiscovery: true,
})

// Conditional Para provider — uses Para SDK when key available, wagmi-only otherwise
async function renderApp() {
  let appElement: React.ReactElement

  if (PARA_API_KEY) {
    try {
      const { ParaProvider, Environment } = await import('@getpara/react-sdk')
      await import('@getpara/react-sdk/styles.css')
      
      appElement = (
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
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </ParaProvider>
      )
      console.info('[vouch] Para SDK initialized with embedded wallets')
    } catch (err) {
      console.warn('[vouch] Para SDK failed to load, falling back to wagmi:', err)
      appElement = (
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </WagmiProvider>
      )
    }
  } else {
    console.info('[vouch] No Para API key — using wagmi with injected wallets (MetaMask, etc.)')
    appElement = (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </WagmiProvider>
    )
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {appElement}
    </StrictMode>,
  )
}

renderApp().catch(err => {
  console.error('[vouch] Fatal render error:', err)
  // Last resort: render with wagmi only
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  )
})
