import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'wagmi'
import { monadTestnet } from 'wagmi/chains'
import { ParaProvider, Environment } from '@getpara/react-sdk'

import App from './App.tsx'
import '@getpara/react-sdk/styles.css'
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

const PARA_API_KEY = import.meta.env.VITE_PARA_API_KEY || ''
const MONAD_TESTNET_RPC = import.meta.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ParaProvider
      paraClientConfig={{
        apiKey: PARA_API_KEY,
        env: Environment.BETA,
      }}
      config={{
        appName: 'Vouch',
      }}
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
  </StrictMode>,
)
