import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { formatMon, shortAddr, vTypeLabel } from '../lib/contract'
import type { EvidenceAuditResponse } from '../lib/api'

interface Props {
  address: `0x${string}` | undefined
  isConnected: boolean
}

/** Local feed-item shape — includes KV-enriched fields served by /api/feed. */
interface FeedItem {
  id: bigint
  creator: `0x${string}`
  counterparty: `0x${string}`
  specHash: `0x${string}`
  vType: number
  status: number
  stake: bigint
  deadline: bigint
  evidenceHash: `0x${string}`
  claim_text?: string | null
  spec?: Record<string, unknown> | null
  evidence?: {
    verdict: EvidenceAuditResponse['verdict']
    confidence: number
    sources?: unknown[]
    attestation?: string
  } | null
}

function secondsUntil(deadline: bigint): number {
  const now = Math.floor(Date.now() / 1000)
  return Number(deadline) - now
}

function statusInfo(status: number): { label: string; cls: string } {
  if (status === 0) return { label: 'active', cls: 'badge-active' }
  if (status === 1) return { label: 'challenged', cls: 'badge-challenged' }
  if (status === 2) return { label: 'settled', cls: 'badge-settled' }
  return { label: 'expired', cls: 'badge-expired' }
}

function verdictInfo(v: EvidenceAuditResponse['verdict']): { label: string; tone: 'success' | 'danger' | 'warning' } {
  if (v === 'pass' || v === 'supported') return { label: 'SUPPORTED', tone: 'success' }
  if (v === 'fail' || v === 'contradicted') return { label: 'CONTRADICTED', tone: 'danger' }
  if (v === 'mixed' || v === 'uncertain') return { label: 'MIXED', tone: 'warning' }
  return { label: 'INSUFFICIENT', tone: 'warning' }
}

function vTypeGlyph(vType: number): string {
  // small inline glyph hint; vTypeLabel gives the text
  switch (vType) {
    case 0: return '📸'
    case 1: return '🌐'
    case 2: return '📍'
    case 3: return '🤝'
    case 4: return '🔌'
    default: return '•'
  }
}

function FeedCard({ item, address }: { item: FeedItem; address?: `0x${string}` }) {
  const st = statusInfo(item.status)
  const remaining = secondsUntil(item.deadline)
  const isMyCommitment = !!address && item.creator.toLowerCase() === address.toLowerCase()
  const isSelf = item.counterparty === '0x0000000000000000000000000000000000000000'
  const claim = item.claim_text?.trim() || (typeof item.spec?.claim_text === 'string' ? item.spec.claim_text : '')
  const hasEvidence = item.evidenceHash && item.evidenceHash !== '0x' + '0'.repeat(64) && item.evidence
  const ev = hasEvidence && item.evidence ? verdictInfo(item.evidence.verdict) : null
  const evToneCls = ev?.tone === 'success' ? 'ev-success' : ev?.tone === 'danger' ? 'ev-danger' : 'ev-warning'

  return (
    <Link to={`/commitment/${item.id.toString()}`} className="feed-item feed-item-v2">
      {/* Hero: claim text */}
      {claim ? (
        <h3 className="feed-claim" title={claim}>{claim}</h3>
      ) : (
        <h3 className="feed-claim feed-claim-hash mono" title="Claim text not yet stored — showing spec hash">
          {item.specHash.slice(0, 10)}…{item.specHash.slice(-6)}
        </h3>
      )}

      {/* Meta row */}
      <div className="feed-meta-top">
        <span className="feed-id">#{item.id.toString()}</span>
        <span className="badge badge-neutral" title={vTypeLabel(item.vType)}>
          <span aria-hidden="true" style={{ marginRight: '0.3rem' }}>{vTypeGlyph(item.vType)}</span>
          {vTypeLabel(item.vType)}
        </span>
        <span className={`badge ${st.cls}`}>{st.label}</span>
        {isMyCommitment && <span className="feed-yours">yours</span>}
        <span className="feed-stake-badge">
          <span className="feed-stake-value">{formatMon(item.stake)}</span>
          <span className="feed-stake-label">MON</span>
        </span>
      </div>

      {/* Parties */}
      <div className="feed-parties">
        <span className="feed-party">
          <span className="feed-party-label">from</span>
          <span className="mono">{shortAddr(item.creator)}</span>
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
              <span className="mono">{shortAddr(item.counterparty)}</span>
            </>
          )}
        </span>
      </div>

      {/* Footer: evidence + countdown */}
      <div className="feed-footer">
        <div className="feed-footer-left">
          {ev && item.evidence && (
            <span className={`ev-badge ${evToneCls}`} title="Fact-checked by three.ws">
              🔍 {ev.label} ({Math.round((item.evidence.confidence ?? 0) * 100)}%)
            </span>
          )}
          <span className={`feed-deadline ${remaining <= 0 ? 'past' : ''}`}>
            {remaining > 0 ? (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M6 3.5V6l1.6 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="feed-deadline-value">{formatRemaining(remaining)}</span>
                <span>left</span>
              </>
            ) : (
              <span>deadline passed</span>
            )}
          </span>
        </div>
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
        <div key={i} className="feed-item feed-item-v2">
          <span className="skeleton" style={{ width: '88%', height: 22, display: 'block', marginBottom: '0.6rem' }} />
          <div className="feed-meta-top">
            <span className="skeleton" style={{ width: 48, height: 16, display: 'inline-block' }} />
            <span className="skeleton" style={{ width: 60, height: 18, display: 'inline-block' }} />
          </div>
          <span className="skeleton" style={{ width: 180, height: 14, display: 'block', marginTop: '0.6rem' }} />
          <span className="skeleton" style={{ width: 140, height: 14, display: 'block', marginTop: '0.4rem' }} />
        </div>
      ))}
    </div>
  )
}

/**
 * Fetch commitments from server-side /api/feed endpoint.
 * Worker reads contract via eth_call, then enriches with specs + evidence from KV.
 */
async function fetchFeedFromAPI(): Promise<FeedItem[]> {
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
    status: Number(c.status ?? 0),
    stake: BigInt(c.stake),
    deadline: BigInt(c.deadline),
    evidenceHash: (c.evidenceHash ?? '0x' + '0'.repeat(64)) as `0x${string}`,
    claim_text: c.claim_text ?? null,
    spec: c.spec ?? null,
    evidence: c.evidence ?? null,
  }))
}

export default function PublicFeed({ address }: Props) {
  const { data: items, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['commitment-feed'],
    queryFn: fetchFeedFromAPI,
    refetchInterval: 15_000,
  })

  const sorted = items?.slice().sort((a, b) => Number(b.id - a.id))

  return (
    <div>
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="page-title">Public feed</h1>
          <p className="page-sub">Live onchain commitments on Vouch · Monad testnet.</p>
        </div>
        {items && items.length > 0 && (
          <div className="page-head-meta">{items.length} total</div>
        )}
      </div>

      {isLoading && <FeedSkeleton />}

      {sorted && sorted.length > 0 && (
        <div className="feed-grid">
          {sorted.map((item) => (
            <FeedCard key={item.id.toString()} item={item} address={address} />
          ))}
        </div>
      )}

      {items && items.length === 0 && !isLoading && (
        <div className="card stack">
          <p className="text-dim">No commitments yet. Create the first one!</p>
        </div>
      )}

      {isError && (
        <div className="card stack">
          <div className="alert alert-error">
            Couldn't load feed: {error instanceof Error ? error.message.slice(0, 140) : 'unknown error'}
          </div>
          <button onClick={() => refetch()} className="btn btn-secondary btn-sm">Retry</button>
        </div>
      )}
    </div>
  )
}
