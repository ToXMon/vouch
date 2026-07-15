import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { type Hash } from 'viem'
import {
  VOUCH_CONTRACT_ADDRESS,
  VOUCH_ABI,
  fetchCommitment,
  fetchIsInChallengeWindow,
  formatMon,
  shortAddr,
  statusLabel,
  vTypeLabel,
} from '../lib/contract'

interface Props {
  address: `0x${string}` | undefined
  isConnected: boolean
}

function StatusBadge({ status }: { status: number }) {
  const label = statusLabel(status).toLowerCase()
  const cls =
    status === 0 ? 'badge-active' :
    status === 1 ? 'badge-challenged' :
    status === 2 ? 'badge-settled' :
    'badge-expired'
  return <span className={`badge ${cls}`}>{label}</span>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail-row">
      <dt className="detail-label">{label}</dt>
      <dd className="detail-value">{children}</dd>
    </div>
  )
}

export default function CommitmentDetail({ address, isConnected }: Props) {
  const { id } = useParams<{ id: string }>()
  const idBigInt = id && /^\d+$/.test(id) ? BigInt(id) : null

  const [challengeArg, setChallengeArg] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionTx, setActionTx] = useState<Hash | null>(null)

  const { writeContractAsync } = useWriteContract()
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: actionTx ?? undefined })

  const { data: commitment, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['commitment', idBigInt?.toString()],
    queryFn: () => fetchCommitment(idBigInt!),
    enabled: !!idBigInt,
    refetchInterval: 10_000,
  })

  const { data: inWindow } = useQuery({
    queryKey: ['challenge-window', idBigInt?.toString()],
    queryFn: () => fetchIsInChallengeWindow(idBigInt!),
    enabled: !!idBigInt,
    refetchInterval: 10_000,
  })

  if (!idBigInt) {
    return (
      <div className="card alert alert-error">
        Invalid commitment ID. <Link to="/" className="text-primary">Back to feed</Link>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="card stack" aria-busy="true">
        <div className="skeleton" style={{ width: 96, height: 20 }} />
        <div className="skeleton" style={{ width: '100%', height: 14 }} />
        <div className="skeleton" style={{ width: '66%', height: 14 }} />
      </div>
    )
  }

  if (isError || !commitment) {
    return (
      <div className="card stack">
        <div className="alert alert-error">
          Couldn't load commitment #{id}: {error instanceof Error ? error.message.slice(0, 120) : 'not found'}
        </div>
        <button onClick={() => refetch()} className="btn btn-secondary btn-sm">Retry</button>
      </div>
    )
  }

  const lower = (a?: string) => a?.toLowerCase() ?? ''
  const isCreator = lower(address) === lower(commitment.creator)
  const isCounterparty = lower(address) === lower(commitment.counterparty)
  const isSelfCommitment = commitment.counterparty === '0x0000000000000000000000000000000000000000'
  const isActive = commitment.status === 0
  const isChallenged = commitment.status === 1
  const isSettled = commitment.status === 2
  const now = Math.floor(Date.now() / 1000)
  const deadlineSecs = Number(commitment.deadline) - now
  const windowOpen = !!inWindow
  const canAutoSettle = isActive && !windowOpen && deadlineSecs < 0

  const handleAction = async (fnName: 'challenge' | 'settle', args: unknown[], label: string) => {
    setActionError(null)
    setActionTx(null)
    try {
      const hash = await writeContractAsync({
        address: VOUCH_CONTRACT_ADDRESS,
        abi: VOUCH_ABI,
        functionName: fnName,
        args,
      } as never)
      setActionTx(hash)
    } catch (err) {
      setActionError(`${label} failed: ${err instanceof Error ? err.message.slice(0, 140) : 'unknown error'}`)
    }
  }

  return (
    <div className="maxw-2xl stack">
      <Link to="/" className="detail-back">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M10 6H2m3 3-3-3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Back to feed
      </Link>

      <div className="card stack">
        <div className="row-between">
          <div>
            <div className="eyebrow mono">Commitment #{id}</div>
            <h1 className="page-title mt-1">
              {formatMon(commitment.stake)} <span className="text-muted" style={{ fontSize: '1rem', fontWeight: 400 }}>MON staked</span>
            </h1>
          </div>
          <StatusBadge status={commitment.status} />
        </div>

        <dl className="detail-list">
          <Row label="Creator">
            <span className="mono">{shortAddr(commitment.creator)}</span>
            {isCreator && <span className="badge badge-accent" style={{ marginLeft: '0.5rem' }}>you</span>}
          </Row>
          <Row label="Counterparty">
            {isSelfCommitment ? (
              <span className="text-muted">self-commitment</span>
            ) : (
              <>
                <span className="mono">{shortAddr(commitment.counterparty)}</span>
                {isCounterparty && <span className="badge badge-accent" style={{ marginLeft: '0.5rem' }}>you</span>}
              </>
            )}
          </Row>
          <Row label="Verification">
            <span className="badge badge-neutral">{vTypeLabel(commitment.vType)}</span>
          </Row>
          <Row label="Deadline">
            {deadlineSecs > 0 ? (
              <span className="text-primary">in {Math.floor(deadlineSecs / 3600)}h {Math.floor((deadlineSecs % 3600) / 60)}m</span>
            ) : (
              <span className="text-danger">passed</span>
            )}
            <div className="text-dim" style={{ fontSize: '0.72rem' }}>{new Date(Number(commitment.deadline) * 1000).toLocaleString()}</div>
          </Row>
          <Row label="Spec hash">
            <span className="mono break-all" style={{ fontSize: '0.72rem' }}>{commitment.specHash}</span>
          </Row>
          {commitment.evidenceHash && commitment.evidenceHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
            <Row label="Evidence hash">
              <span className="mono break-all" style={{ fontSize: '0.72rem' }}>{commitment.evidenceHash}</span>
            </Row>
          )}
        </dl>
      </div>

      {/* Status-specific banner */}
      {isSettled && (
        <div className="alert alert-info">
          This commitment has been settled and the stake distributed.
        </div>
      )}

      {windowOpen && !isChallenged && !isSelfCommitment && (
        <div className="alert alert-warning">
          Challenge window open — counterparty may dispute within 24h of the deadline.
        </div>
      )}

      {isChallenged && (
        <div className="alert alert-warning">
          Challenged — awaiting AI adjudicator ruling.
        </div>
      )}

      {actionError && <div role="alert" className="alert alert-error">{actionError}</div>}
      {actionTx && (
        <div role="status" className="alert alert-success">
          {confirmed ? '✓ Confirmed' : confirming ? 'Confirming onchain…' : 'Submitted'}
          <div className="mono break-all" style={{ fontSize: '0.72rem', opacity: 0.8, marginTop: '0.3rem' }}>tx: {actionTx}</div>
        </div>
      )}

      {/* Actions */}
      {isConnected && !isSettled && (
        <div className="card stack">
          <div className="section-label">Actions</div>

          {/* Counterparty: challenge during window */}
          {isCounterparty && isActive && windowOpen && (
            <div className="stack-tight">
              <label htmlFor="challenge-arg" className="label">Challenge argument (optional)</label>
              <textarea
                id="challenge-arg"
                className="textarea"
                placeholder="Why should this commitment be rejected?"
                value={challengeArg}
                onChange={(e) => setChallengeArg(e.target.value)}
                rows={2}
              />
              <button
                type="button"
                className="btn btn-danger btn-block"
                disabled={confirming}
                onClick={() => handleAction('challenge', [idBigInt], 'Challenge')}
              >
                {confirming ? 'Confirming…' : 'Challenge this commitment'}
              </button>
              {challengeArg && (
                <p className="text-dim" style={{ fontSize: '0.72rem' }}>
                  Note: the onchain challenge() takes no argument — your text here is for the AI adjudicator context and not stored onchain in this MVP.
                </p>
              )}
            </div>
          )}

          {/* Anyone: auto-settle after window closes if unchallenged */}
          {isActive && canAutoSettle && (
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={confirming}
              onClick={() => handleAction('settle', [idBigInt, true], 'Settle')}
            >
              {confirming ? 'Confirming…' : 'Settle (creator wins — uncontested)'}
            </button>
          )}

          {/* Adjudicator-only: settle disputed */}
          {isChallenged && (
            <div className="stack-tight">
              <p className="text-muted" style={{ fontSize: '0.8rem' }}>
                Disputed commitments can only be settled by the onchain adjudicator wallet. The frontend will pass your ruling to <code className="code-inline">settle(id, creatorWins)</code>.
              </p>
              <div className="choice-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={confirming}
                  onClick={() => handleAction('settle', [idBigInt, true], 'Settle (creator wins)')}
                >
                  Creator wins
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={confirming}
                  onClick={() => handleAction('settle', [idBigInt, false], 'Settle (counterparty wins)')}
                >
                  Counterparty wins
                </button>
              </div>
            </div>
          )}

          {/* No actions available */}
          {!windowOpen && !canAutoSettle && !isChallenged && (
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>
              No actions available for this commitment in its current state.
            </p>
          )}

          {!isConnected && (
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>Connect your wallet to take action on this commitment.</p>
          )}
        </div>
      )}
    </div>
  )
}
