import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchCommitmentCreatedLogs, formatMon, shortAddr, vTypeLabel, type CommitmentCreatedLog } from '../lib/contract'

interface Props {
  address: `0x${string}` | undefined
  isConnected: boolean
}

function secondsUntil(deadline: bigint): number {
  const now = Math.floor(Date.now() / 1000)
  return Number(deadline) - now
}

function statusFromLog(log: CommitmentCreatedLog): 'active' | 'expired' {
  // Created logs only tell us the deadline; without a follow-up getCommitment
  // call we infer: past deadline + 24h challenge window → expired.
  const deadlinePlusChallenge = Number(log.deadline) + 86_400
  return Date.now() / 1000 < deadlinePlusChallenge ? 'active' : 'expired'
}

function FeedCard({ log }: { log: CommitmentCreatedLog }) {
  const status = statusFromLog(log)
  const remaining = secondsUntil(log.deadline)
  const isMyCommitment = !!window && log.creator.toLowerCase() === (window as unknown as { ethereum?: { selectedAddress?: string } }).ethereum?.selectedAddress?.toLowerCase()

  return (
    <Link
      to={`/commitment/${log.id.toString()}`}
      className="card block transition-colors hover:bg-zinc-800/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="mono text-xs text-zinc-500">#{log.id.toString()}</span>
          <span className="badge badge-active">{vTypeLabel(log.vType)}</span>
          {status === 'expired' ? (
            <span className="badge badge-expired">expired</span>
          ) : (
            <span className="badge badge-active">active</span>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-emerald-300">{formatMon(log.stake)} MON</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">stake</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">creator</span>
          <span className="mono text-zinc-300">{shortAddr(log.creator)}</span>
        </div>
        <svg className="h-3 w-3 text-zinc-600" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6h8m-3-3 3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex items-center gap-1.5">
          <span className="mono text-zinc-300">{log.counterparty === '0x0000000000000000000000000000000000000000' ? 'self' : shortAddr(log.counterparty)}</span>
          <span className="text-zinc-500">counterparty</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
        <div className="text-xs text-zinc-500">
          {remaining > 0 ? (
            <>deadline in <span className="font-medium text-zinc-300">{formatRemaining(remaining)}</span></>
          ) : (
            <span className="text-rose-400">deadline passed</span>
          )}
        </div>
        {isMyCommitment && (
          <span className="text-[10px] uppercase tracking-wider text-emerald-400/70">yours</span>
        )}
      </div>
    </Link>
  )
}

function formatRemaining(secs: number): string {
  if (secs <= 0) return 'expired'
  const d = Math.floor(secs / 86_400)
  const h = Math.floor((secs % 86_400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function FeedSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading commitments">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card space-y-3">
          <div className="h-4 w-20 skeleton" />
          <div className="h-3 w-full skeleton" />
          <div className="h-3 w-2/3 skeleton" />
        </div>
      ))}
    </div>
  )
}

export default function PublicFeed({ address, isConnected }: Props) {
  void address
  void isConnected

  const { data: logs, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['commitment-created-logs'],
    queryFn: () => fetchCommitmentCreatedLogs(0n),
    refetchInterval: 15_000,
  })

  const sorted = logs?.slice().sort((a, b) => Number(b.id - a.id))

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Public feed</h1>
          <p className="mt-1 text-sm text-zinc-400">Live onchain commitments on Vouch · Monad testnet.</p>
        </div>
        {logs && logs.length > 0 && (
          <div className="text-xs text-zinc-500">{logs.length} total</div>
        )}
      </div>

      {isLoading && <FeedSkeleton />}

      {isError && (
        <div className="card space-y-3">
          <div className="alert alert-error">
            Couldn't load commitments: {error instanceof Error ? error.message.slice(0, 120) : 'RPC error'}.
            <br />
            Verify <code className="mono text-[11px]">VITE_VOUCH_CONTRACT_ADDRESS</code> and <code className="mono text-[11px]">VITE_MONAD_RPC_URL</code> in your env.
          </div>
          <button onClick={() => refetch()} className="btn btn-secondary btn-sm">Retry</button>
        </div>
      )}

      {!isLoading && !isError && sorted && sorted.length === 0 && (
        <div className="card empty-state">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14m-7-7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-zinc-200">No commitments yet</h2>
          <p className="mt-1 text-sm">Be the first to stake on a personal claim.</p>
          <Link to="/create" className="btn btn-primary btn-sm mt-4">Create a commitment →</Link>
        </div>
      )}

      {!isLoading && !isError && sorted && sorted.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.map((log) => <FeedCard key={log.id.toString()} log={log} />)}
        </div>
      )}
    </div>
  )
}
