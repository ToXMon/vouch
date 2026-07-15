import { useState } from 'react'
import { useAccount, useBalance, useConnect, useDisconnect } from 'wagmi'
import { shortAddr } from '../lib/contract'

export default function WalletConnect() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { connectors, connectAsync, isPending } = useConnect()
  const { data: balance } = useBalance({ address, watch: true })
  const [copied, setCopied] = useState(false)

  const handleConnect = async () => {
    // Try injected wallet first, fall back to first available connector
    const connector = connectors.find(c => c.type === 'injected') ?? connectors[0]
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
