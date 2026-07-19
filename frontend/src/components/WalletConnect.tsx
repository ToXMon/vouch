import { useState } from 'react'
import { useAccount, useBalance, useDisconnect, useConnect } from 'wagmi'
import { useModal } from '@getpara/react-sdk'
import { shortAddr } from '../lib/contract'

declare global {
  interface Window {
    __PARA_API_KEY__?: string
    ethereum?: any
  }
}

const PARA_API_KEY =
  import.meta.env.VITE_PARA_API_KEY ||
  (typeof window !== 'undefined' ? window.__PARA_API_KEY__ || '' : '')

/**
 * Shared connected-state UI used by both variants.
 */
function ConnectedWallet({
  address,
  onDisconnect,
}: {
  address: string
  onDisconnect: () => void
}) {
  const { data: balance } = useBalance({ address, watch: true })
  const [copied, setCopied] = useState(false)

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

  const bal = balance?.formatted ? Number(balance.formatted).toFixed(2) : '0.00'
  const symbol = balance?.symbol ?? 'MON'

  return (
    <div className="wallet-cluster">
      <div className="wallet-pill wallet-balance-pill" title={`${bal} ${symbol}`}>
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
        onClick={() => onDisconnect()}
        className="btn btn-ghost btn-sm"
        aria-label="Disconnect wallet"
        title="Disconnect"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M11 9V5a3 3 0 0 0-6 0v4M4 9h8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

/**
 * Para SDK button.
 * ONLY render this inside <ParaProvider> — useModal() requires that context.
 * main.tsx wraps children in <ParaProvider> iff PARA_API_KEY is set; the
 * default-export WalletConnect below mounts this variant only in that case,
 * so useModal() is never called outside the provider.
 */
export function ParaWalletConnect() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const paraModal = useModal()
  const openModal = paraModal?.openModal
  const [err, setErr] = useState<string | null>(null)

  if (isConnected && address) {
    return <ConnectedWallet address={address} onDisconnect={() => disconnect()} />
  }

  const handle = () => {
    setErr(null)
    if (openModal) {
      try {
        openModal()
      } catch (e) {
        setErr(`Para modal error: ${e}`)
      }
    } else {
      // openModal missing means provider wired but modal hook returned null
      setErr('Para modal unavailable')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handle}
        className="btn btn-primary btn-sm"
        aria-label="Connect wallet"
      >
        Connect Wallet
      </button>
      {err && (
        <span className="wallet-error" role="alert" style={{ marginLeft: 8 }}>
          {err}
        </span>
      )}
    </>
  )
}

/**
 * wagmi-only button. Never calls useModal(), so it is safe outside any
 * Para context. Includes a direct window.ethereum injection fallback for
 * environments where injected connectors are not yet discovered, plus
 * visible status/error feedback.
 */
export function WagmiWalletConnect() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { connectors, connectAsync, isPending, error } = useConnect()
  const [status, setStatus] = useState<string | null>(null)

  if (isConnected && address) {
    return <ConnectedWallet address={address} onDisconnect={() => disconnect()} />
  }

  const handle = async () => {
    setStatus(null)
    const connector = connectors[0]
    if (connector) {
      try {
        await connectAsync({ connector })
        return
      } catch (e) {
        // Fall through to direct injection on any wagmi failure.
        console.error('[vouch] wagmi connect failed, attempting direct injection:', e)
      }
    }

    // Last-resort: speak window.ethereum directly.
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined
    if (eth?.request) {
      try {
        const accts: string[] = await eth.request({ method: 'eth_requestAccounts' })
        if (!accts || accts.length === 0) {
          setStatus('No accounts returned by wallet')
        }
      } catch (e: any) {
        setStatus(
          e?.code === 4001
            ? 'Connection rejected'
            : `Wallet error: ${e?.message || e}`,
        )
      }
      return
    }

    setStatus('No wallet detected — install MetaMask')
    window.open('https://metamask.io/download/', '_blank', 'noopener')
  }

  const msg = status || (error ? `Error: ${error.message}` : null)

  return (
    <>
      <button
        type="button"
        onClick={handle}
        disabled={isPending}
        className="btn btn-primary btn-sm"
        aria-label="Connect wallet"
      >
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {msg && (
        <span className="wallet-error" role="alert" style={{ marginLeft: 8 }}>
          {msg}
        </span>
      )}
    </>
  )
}

/**
 * Default export: picks the Para variant iff a PARA_API_KEY is present, mirroring
 * the provider-selection logic in main.tsx. This guarantees useModal() is only
 * invoked when <ParaProvider> is mounted in the tree.
 */
export default function WalletConnect() {
  return PARA_API_KEY ? <ParaWalletConnect /> : <WagmiWalletConnect />
}
