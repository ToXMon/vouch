import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, createConfig, WagmiProvider } from 'wagmi'
import { monadTestnet } from 'wagmi/chains'
import { ParaProvider, Environment } from '@getpara/react-sdk'
import '@getpara/react-sdk/styles.css'

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

// Wagmi fallback config — only used when Para key is absent
const fallbackWagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(MONAD_TESTNET_RPC),
  },
  multiInjectedProviderDiscovery: true,
})

/**
 * When Para key is present: ParaProvider provides wagmi context internally.
 * Do NOT wrap in a separate WagmiProvider — it shadows Para's connectors.
 * When Para key is absent: WagmiProvider with injected wallets (MetaMask).
 */
function WalletProviders({ children }: { children: React.ReactNode }) {
  if (PARA_API_KEY) {
    return (
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
              transports: { [monadTestnet.id]: http(MONAD_TESTNET_RPC) },
            },
          },
          wallets: ['METAMASK', 'COINBASE', 'WALLETCONNECT'],
        }}
      >
        {children}
      </ParaProvider>
    )
  }
  // Fallback: wagmi only (MetaMask/injected)
  return (
    <WagmiProvider config={fallbackWagmiConfig}>
      {children}
    </WagmiProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <WalletProviders>
          <App />
        </WalletProviders>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
