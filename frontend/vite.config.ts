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
  },
})
