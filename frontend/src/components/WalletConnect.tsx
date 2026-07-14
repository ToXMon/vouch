import { useState } from 'react'
import { useAccount, useBalance, useConnect, useDisconnect } from 'wagmi'
import { shortAddr } from '../lib/contract'

/**
 * Para wallet connect button. Uses wagmi hooks (ParaProvider v2 wires up the
 * wagmi connector internally). The first connector in the wagmi config is the
 * Para embedded-wallet connector — clicking connect triggers the Para modal.
 */
export default function WalletConnect() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { connectors, connectAsync, isPending } = useConnect()
  const { data: balance } = useBalance({ address, watch: true })
  const [copied, setCopied] = useState(false)

  // ParaProvider v2 exposes its connector as the first entry; the Para modal
  // opens automatically when connect() is called with it.
  const paraConnector = connectors[0]

  const handleConnect = async () => {
    if (!paraConnector) return
    try {
      await connectAsync({ connector: paraConnector })
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
      /* clipboard blocked — silent fail */
    }
  }

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        onClick={handleConnect}
        disabled={isPending || !paraConnector}
        className="btn btn-primary btn-sm"
        aria-label="Connect Para wallet"
      >
        {isPending ? (
          <>
            <span className="spin inline-block h-3 w-3 rounded-full border-2 border-emerald-900 border-t-transparent" aria-hidden="true" />
            Connecting…
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <rect x="6" y="6" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Connect Wallet
          </>
        )
      </button>
    )
  }

  const bal = balance?.formatted ? Number(balance.formatted).toFixed(3) : '0.000'
  const symbol = balance?.symbol ?? 'MON'

  return (
    <div className="flex items-center gap-2">
      <div
        className="hidden items-center gap-2 rounded-md border border-white/5 bg-white/5 px-2.5 py-1.5 sm:flex"
        title={`${bal} ${symbol}`}
      >
        <span className="text-xs font-medium text-zinc-300">{bal}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{symbol}</span>
      </div>
      <button
        type="button"
        onClick={copyAddress}
        className="group flex items-center gap-2 rounded-md border border-white/5 bg-white/5 px-2.5 py-1.5 transition-colors hover:bg-white/10"
        title="Copy address"
        aria-label={`Connected address ${address}. Click to copy.`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        <span className="mono text-xs font-medium text-zinc-200">{copied ? 'Copied!' : shortAddr(address)}</span>
      </button>
      <button
        type="button"
        onClick={() => disconnect()}
        className="btn btn-ghost btn-sm"
        aria-label="Disconnect wallet"
        title="Disconnect"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11 9V5a3 3 0 0 0-6 0v4M4 9h8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
