import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Environment, ParaProvider } from '@getpara/react-sdk'
import { http } from 'wagmi'
import { monadTestnet } from 'wagmi/chains'
import '@getpara/react-sdk/styles.css'

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

const PARA_API_KEY = import.meta.env.VITE_PARA_API_KEY
const PARA_ENV = (import.meta.env.VITE_PARA_ENVIRONMENT ?? 'beta') === 'production' ? Environment.PRODUCTION : Environment.BETA

if (!PARA_API_KEY) {
  // Don't throw — let the app render so users see the config warning instead of a blank screen.
  console.warn('[vouch] VITE_PARA_API_KEY is not set. Wallet connection will fail until it is configured.')
}

const MONAD_TESTNET_RPC = import.meta.env.VITE_MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{
          apiKey: PARA_API_KEY ?? '',
          env: PARA_ENV,
        }}
        config={{ appName: 'Vouch' }}
        paraModalConfig={{
          oAuthMethods: ['GOOGLE', 'APPLE', 'DISCORD', 'TWITTER', 'FACEBOOK', 'FARCASTER'],
          disablePhoneLogin: false,
          recoverySecretStepEnabled: true,
        }}
        externalWalletConfig={{
          evmConnector: {
            config: {
              // First entry is the default chain users land on at connect.
              chains: [monadTestnet],
              transports: {
                [monadTestnet.id]: http(MONAD_TESTNET_RPC),
              },
            },
          },
          wallets: ['METAMASK', 'COINBASE', 'WALLETCONNECT', 'RAINBOW'],
        }}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ParaProvider>
    </QueryClientProvider>
  </StrictMode>,
)
