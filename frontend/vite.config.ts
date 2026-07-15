import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vouch frontend — Vite + React 18 + TypeScript
// Para wallet integration, Monad testnet contract calls
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // Suppress dynamic import resolution warnings from Web3 SDKs (Para, wagmi, viem)
        // These are safe at runtime — Vite bundles everything, the warnings are false positives
        if (warning.code === 'INVALID_ANNOTATION' || 
            warning.code === 'UNRESOLVED_IMPORT' ||
            warning.code === 'THIS_IS_UNDEFINED' ||
            warning.message?.includes('rollupOptions.external') ||
            warning.message?.includes('dynamic import') ||
            warning.message?.includes('externally')) {
          return
        }
        defaultHandler(warning)
      },
    },
  },
  optimizeDeps: {
    include: [
      '@getpara/react-sdk',
      '@getpara/evm-wallet-connectors',
      'wagmi',
      'viem',
      '@tanstack/react-query',
      'axios',
      'react-router-dom',
    ],
  },
})
