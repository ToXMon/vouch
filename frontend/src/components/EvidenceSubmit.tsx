import { useState, useEffect } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { keccak256, stringToHex, toBytes, type Hash } from 'viem'
import { VOUCH_CONTRACT_ADDRESS, VOUCH_ABI } from '../lib/contract'
import { auditEvidence, storeEvidence, type VerificationTypeApi, type EvidenceAuditResponse } from '../lib/api'

interface Props {
  address: `0x${string}` | undefined
  isConnected: boolean
}

const VTYPE_API: { label: string; value: VerificationTypeApi }[] = [
  { label: 'Photo', value: 'photo' },
  { label: 'Web', value: 'web' },
  { label: 'Location', value: 'location' },
  { label: 'Peer Sign', value: 'peer_sign' },
  { label: 'API', value: 'api' },
]

function verdictTone(v: EvidenceAuditResponse['verdict']): 'success' | 'danger' | 'warning' {
  if (v === 'pass' || v === 'supported') return 'success'
  if (v === 'fail' || v === 'contradicted') return 'danger'
  return 'warning'
}

function ConfidenceMeter({ value, tone }: { value: number; tone: 'success' | 'danger' | 'warning' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  const barColor = tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--warning)'
  return (
    <div className="confidence-meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="confidence-bar" style={{ width: `${pct}%`, background: barColor }} />
      <span className="confidence-label" style={{ color: barColor }}>{pct}%</span>
    </div>
  )
}

export default function EvidenceSubmit({ isConnected }: Props) {
  const [commitmentId, setCommitmentId] = useState('')
  const [claim, setClaim] = useState('')
  const [evidence, setEvidence] = useState('')
  const [vtype, setVtype] = useState<VerificationTypeApi>('photo')
  const [auditing, setAuditing] = useState(false)
  const [verdict, setVerdict] = useState<EvidenceAuditResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [evidenceHash, setEvidenceHash] = useState<`0x${string}` | null>(null)
  const [txHash, setTxHash] = useState<Hash | null>(null)
  const [stored, setStored] = useState(false)

  const { writeContractAsync } = useWriteContract()
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

  const idParsed = commitmentId.trim() !== '' && /^\d+$/.test(commitmentId.trim())
  const canAudit = claim.trim().length >= 8 && evidence.trim().length >= 1 && !auditing

  // ── Auto-store evidence verdict in KV once tx confirms ──────
  useEffect(() => {
    if (!confirmed || !txHash || !evidenceHash || !verdict || stored) return
    storeEvidence({
      evidenceHash,
      commitmentId: commitmentId.trim(),
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      sources: verdict.sources || [],
      attestation: verdict.attestation || '',
      claim: claim.trim(),
    }).then(() => setStored(true))
  }, [confirmed, txHash, evidenceHash, verdict, stored, commitmentId, claim])

  const handleAudit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canAudit) return
    setError(null)
    setVerdict(null)
    setTxHash(null)
    setEvidenceHash(null)
    setStored(false)
    setAuditing(true)

    try {
      const res = await auditEvidence({
        claim_text: claim.trim(),
        evidence: evidence.trim(),
        verification_type: vtype,
      })
      setVerdict(res)
      // Hash the raw evidence for onchain submission
      const hash = keccak256(toBytes(stringToHex(evidence.trim())))
      setEvidenceHash(hash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI audit failed')
    } finally {
      setAuditing(false)
    }
  }

  const handleSubmitOnchain = async () => {
    if (!evidenceHash || !idParsed) return
    setError(null)
    setTxHash(null)
    setStored(false)
    try {
      const hash = await writeContractAsync({
        address: VOUCH_CONTRACT_ADDRESS,
        abi: VOUCH_ABI,
        functionName: 'submitEvidence',
        args: [BigInt(commitmentId.trim()), evidenceHash],
      })
      setTxHash(hash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onchain submit failed')
    }
  }

  if (!isConnected) {
    return (
      <div className="maxw-2xl">
        <div className="card text-center">
          <h1 className="mb-1">Connect your wallet to submit evidence</h1>
          <p className="text-muted">Only the commitment creator can submit evidence before the deadline.</p>
        </div>
      </div>
    )
  }

  const tone = verdict ? verdictTone(verdict.verdict) : 'warning'
  const toneCls = tone === 'success' ? 'alert-success' : tone === 'danger' ? 'alert-error' : 'alert-warning'
  const sources = Array.isArray(verdict?.sources) ? verdict.sources : []

  return (
    <div className="maxw-2xl">
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="page-title">Submit evidence</h1>
          <p className="page-sub">
            Paste a photo URL, screenshot, or text proof. The AI auditor checks it against the claim, then you can anchor the hash onchain.
          </p>
        </div>
      </div>

      <form onSubmit={handleAudit} className="card stack">
        <div className="field">
          <label htmlFor="cid" className="label">Commitment ID</label>
          <input
            id="cid"
            className="input mono"
            placeholder="e.g. 7"
            value={commitmentId}
            onChange={(e) => setCommitmentId(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            disabled={!!txHash}
          />
        </div>

        <div className="field">
          <label htmlFor="claim" className="label">Original claim</label>
          <textarea
            id="claim"
            className="textarea"
            placeholder="The claim this evidence supports"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={2}
            required
            minLength={8}
            disabled={!!txHash}
          />
        </div>

        <div className="field">
          <label className="label">Verification type</label>
          <div className="choice-row">
            {VTYPE_API.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setVtype(opt.value)}
                aria-pressed={vtype === opt.value}
                className="choice"
                disabled={!!txHash}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="evidence" className="label">Evidence (URL or text)</label>
          <textarea
            id="evidence"
            className="textarea"
            placeholder="https://…/proof.jpg  ·  Strava activity URL  ·  Witness statement text"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={4}
            required
            disabled={!!txHash}
          />
        </div>

        {error && <div role="alert" className="alert alert-error">{error}</div>}

        {!verdict && (
          <button type="submit" className="btn btn-primary btn-block" disabled={!canAudit}>
            {auditing ? (
              <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--primary-fg)', borderTopColor: 'transparent' }} /> Fact-checking with three.ws…</>
            ) : (
              <>🔍 Fact-check evidence</>
            )}
          </button>
        )}
      </form>

      {/* ── Verdict panel (rich three.ws display) ──────────── */}
      {verdict && (
        <div className={`card stack ${toneCls}`} style={{ marginTop: '1rem' }}>
          <div className="row-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <div className="eyebrow">AI Verdict · Fact-checked by three.ws</div>
              <div className="verdict-value" style={{ marginTop: '0.3rem' }}>{verdict.verdict.toUpperCase()}</div>
            </div>
            <div style={{ minWidth: '180px' }}>
              <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>Confidence</div>
              <ConfidenceMeter value={verdict.confidence} tone={tone} />
            </div>
          </div>

          {verdict.reasoning && (
            <p style={{ fontSize: '0.88rem', lineHeight: 1.6, opacity: 0.92 }}>{verdict.reasoning}</p>
          )}

          {sources.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>Sources cited</div>
              <ul className="sources-list">
                {sources.map((src, i) => {
                  const url = typeof src === 'string' ? src : (src as any)?.url || (src as any)?.title || JSON.stringify(src)
                  const isUrl = typeof url === 'string' && /^https?:\/\//.test(url)
                  return (
                    <li key={i}>
                      {isUrl ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="source-link">
                          {String(url).length > 70 ? String(url).slice(0, 67) + '…' : url}
                        </a>
                      ) : (
                        <span>{String(url)}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {verdict.attestation && (
            <div className="stack-tight">
              <div className="eyebrow">SHA-256 Attestation</div>
              <div className="mono break-all" style={{ fontSize: '0.72rem', opacity: 0.85 }}>{verdict.attestation}</div>
            </div>
          )}

          {evidenceHash && (
            <>
              <div className="divider" style={{ margin: '0.5rem 0', opacity: 0.4 }} />
              <div className="stack-tight">
                <div>
                  <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>Evidence hash (keccak256)</div>
                  <div className="mono break-all" style={{ fontSize: '0.72rem', opacity: 0.9 }}>{evidenceHash}</div>
                </div>

                {!txHash && (
                  <button
                    type="button"
                    onClick={handleSubmitOnchain}
                    disabled={!idParsed || confirming}
                    className="btn btn-primary btn-block"
                  >
                    {confirming ? (
                      <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--primary-fg)', borderTopColor: 'transparent' }} /> Confirming…</>
                    ) : (
                      <>Anchor onchain (submitEvidence)</>
                    )}
                  </button>
                )}

                {txHash && (
                  <div role="status" className="stack-tight">
                    <div className="alert alert-success" style={{ marginTop: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        {confirmed ? '✓ Submitted onchain' : confirming ? 'Confirming onchain…' : 'Transaction submitted'}
                      </div>
                      <div className="mono break-all" style={{ fontSize: '0.72rem', opacity: 0.8, marginTop: '0.3rem' }}>tx: {txHash}</div>
                      {confirmed && stored && (
                        <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--success)' }}>
                          ✓ Verdict stored — feed will display the fact-check
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!idParsed && commitmentId && (
                  <p className="text-danger" style={{ fontSize: '0.78rem' }}>Enter a valid numeric commitment ID to submit onchain.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
