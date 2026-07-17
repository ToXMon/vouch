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

function FeedCard({ log, address }: { log: CommitmentCreatedLog; address?: `0x${string}` }) {
  const status = statusFromLog(log)
  const remaining = secondsUntil(log.deadline)
  const isMyCommitment = !!address && log.creator.toLowerCase() === address.toLowerCase()
  const isSelf = log.counterparty === '0x0000000000000000000000000000000000000000'

  return (
    <Link
      to={`/commitment/${log.id.toString()}`}
      className="feed-item"
    >
      <div className="feed-row">
        <div>
          <div className="feed-meta-top">
            <span className="feed-id">#{log.id.toString()}</span>
            <span className="badge badge-neutral">{vTypeLabel(log.vType)}</span>
            {status === 'expired' ? (
              <span className="badge badge-expired">expired</span>
            ) : (
              <span className="badge badge-active">active</span>
            )}
            {isMyCommitment && <span className="feed-yours">yours</span>}
          </div>
        </div>
        <div className="feed-stake">
          <span className="feed-stake-value">{formatMon(log.stake)}</span>
          <span className="feed-stake-label">MON staked</span>
        </div>
      </div>

      <div className="feed-parties">
        <span className="feed-party">
          <span className="feed-party-label">from</span>
          <span className="mono">{shortAddr(log.creator)}</span>
        </span>
        <svg className="feed-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6h8m-3-3 3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="feed-party">
          {isSelf ? (
            <span className="text-dim">self-commitment</span>
          ) : (
            <>
              <span className="feed-party-label">to</span>
              <span className="mono">{shortAddr(log.counterparty)}</span>
            </>
          )}
        </span>
      </div>

      <div className="feed-footer">
        <span className={`feed-deadline ${remaining <= 0 ? 'past' : ''}`}>
          {remaining > 0 ? (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6 3.5V6l1.6 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span className="feed-deadline-value">{formatRemaining(remaining)}</span>
              <span>remaining</span>
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6 3.5V6l1.6 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span>deadline passed</span>
            </>
          )}
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ color: 'var(--text-dim)' }}>
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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
    <div className="feed-grid" aria-busy="true" aria-label="Loading commitments">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="feed-item">
          <div className="feed-row">
            <div>
              <div className="feed-meta-top">
                <span className="skeleton" style={{ width: 48, height: 16, display: 'inline-block' }} />
                <span className="skeleton" style={{ width: 60, height: 18, display: 'inline-block' }} />
              </div>
            </div>
            <div className="feed-stake">
              <span className="skeleton" style={{ width: 56, height: 20, display: 'inline-block' }} />
              <span className="skeleton" style={{ width: 40, height: 10, display: 'inline-block', marginTop: 4 }} />
            </div>
          </div>
          <div className="feed-parties">
            <span className="skeleton" style={{ width: 180, height: 14, display: 'inline-block' }} />
          </div>
          <div className="feed-footer">
            <span className="skeleton" style={{ width: 120, height: 14, display: 'inline-block' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Fetch commitments from server-side /api/feed endpoint.
 * Worker reads contract via eth_call (bypasses 100-block log limit).
 */
async function fetchFeedFromAPI(): Promise<CommitmentCreatedLog[]> {
  const resp = await fetch('/api/feed')
  if (!resp.ok) throw new Error(`Feed API returned ${resp.status}`)
  const data = await resp.json()
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : 'RPC error')
  if (!data.commitments || !Array.isArray(data.commitments)) return []

  return data.commitments.map((c: any) => ({
    id: BigInt(c.id),
    creator: c.creator as `0x${string}`,
    counterparty: c.counterparty as `0x${string}`,
    specHash: c.specHash as `0x${string}`,
    vType: Number(c.vType),
    stake: BigInt(c.stake),
    deadline: BigInt(c.deadline),
  }))
}

export default function PublicFeed({ address, isConnected }: Props) {

  const { data: logs, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['commitment-feed'],
    queryFn: fetchFeedFromAPI,
    refetchInterval: 15_000,
  })

  const sorted = logs?.slice().sort((a, b) => Number(b.id - a.id))

  return (
    <div>
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="page-title">Public feed</h1>
          <p className="page-sub">Live onchain commitments on Vouch · Monad testnet.</p>
        </div>
        {logs && logs.length > 0 && (
          <div className="page-head-meta">{logs.length} total</div>
        )}
      </div>

      {isLoading && <FeedSkeleton />}

      {logs && logs.length > 0 && (
        <div className="feed-grid">
          {sorted!.map((log) => (
            <FeedCard key={log.id.toString()} log={log} address={address} />
          ))}
        </div>
      )}

      {logs && logs.length === 0 && !isLoading && (
        <div className="card stack">
          <p className="text-dim">No commitments yet. Create the first one!</p>
        </div>
      )}

      {isError && (
        <div className="card stack">
          <div className="alert alert-error">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <strong>Connection issue</strong>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              The Monad testnet is taking a moment to respond. This usually clears up in a few seconds.
            </p>
          </div>
          <button onClick={() => refetch()} className="btn btn-secondary btn-sm">Try again</button>
        </div>
      )}

      {!isLoading && !isError && sorted && sorted.length === 0 && (
        <div className="card empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14m-7-7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h2>No commitments yet</h2>
          <p>Be the first to stake MON on a personal claim. Create a commitment, lock your stake onchain, and let AI verify the outcome.</p>
          <div className="empty-state-actions" style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
            <Link to="/create" className="btn btn-primary btn-sm">Create a commitment →</Link>
          </div>
          {!isConnected && (
            <p className="text-dim" style={{ fontSize: '0.78rem', marginTop: '0.75rem' }}>Connect your wallet first to get started.</p>
          )}
        </div>
      )}

      {!isLoading && !isError && sorted && sorted.length > 0 && (
        <div className="feed-grid">
          {sorted.map((log) => <FeedCard key={log.id.toString()} log={log} />)}
        </div>
      )}
    </div>
  )
}
