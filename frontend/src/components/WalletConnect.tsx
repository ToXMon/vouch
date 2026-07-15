import { useState, useEffect } from 'react'
import { useAccount, useBalance, useDisconnect, useConnect } from 'wagmi'
import { usePara } from '@getpara/react-sdk'
import { shortAddr } from '../lib/contract'

declare global {
  interface Window { __PARA_API_KEY__?: string }
}

const HAS_PARA = !!(import.meta.env.VITE_PARA_API_KEY || (typeof window !== 'undefined' && window.__PARA_API_KEY__))

export default function WalletConnect() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { connectors, connectAsync, isPending } = useConnect()
  const { data: balance } = useBalance({ address, watch: true })
  const [copied, setCopied] = useState(false)

  // Para SDK hook — must be called unconditionally (Rules of Hooks)
  // usePara returns null/empty when outside ParaProvider
  let paraModal: { openModal?: () => void; closeModal?: () => void } = {}
  let paraClient: any = null
  try {
    const para = usePara()
    paraModal.openModal = para?.openModal
    paraModal.closeModal = para?.closeModal
    paraClient = para?.para
  } catch {
    // usePara not available (no ParaProvider or key absent)
  }

  const handleConnect = async () => {
    // Priority 1: Para SDK openModal
    if (paraModal.openModal) {
      paraModal.openModal()
      return
    }

    // Priority 2: Para client signIn/signUp
    if (paraClient && typeof paraClient.signIn === 'function') {
      try {
        await paraClient.signIn()
        return
      } catch (err) {
        console.error('[vouch] Para signIn failed:', err)
      }
    }

    // Fallback: wagmi connect (MetaMask/injected)
    const connector = connectors[0]
    if (!connector) {
      console.error('[vouch] No wallet connector available')
      return
    }
    try {
      await connectAsync({ connector })
    } catch (err) {
      console.error('[vouch] wallet connect failed:', err)
    }
  }

  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard blocked */
    }
  }

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={handleConnect}
        disabled={isPending}
        className="btn btn-primary btn-sm"
        aria-label="Connect wallet"
      >
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </button>
    )
  }

  const bal = balance?.formatted ? Number(balance.formatted).toFixed(2) : '0.00'
  const symbol = balance?.symbol ?? 'MON'

  return (
    <div className="wallet-cluster">
      <div
        className="wallet-pill wallet-balance-pill"
        title={`${bal} ${symbol}`}
      >
        <span className="wallet-balance">{bal}</span>
        <span className="wallet-balance-symbol">{symbol}</span>
      </div>
      <button
        type="button"
        onClick={copyAddress}
        className="wallet-pill"
        title="Copy address"
        aria-label={`Connected address ${address}. Click to copy.`}
      >
        <span className="wallet-dot" aria-hidden="true" />
        <span className="wallet-addr">{copied ? 'Copied!' : shortAddr(address)}</span>
      </button>
      <button
        type="button"
        onClick={() => disconnect()}
        className="btn btn-ghost btn-sm"
        aria-label="Disconnect wallet"
        title="Disconnect"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11 9V5a3 3 0 0 0-6 0v4M4 9h8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
