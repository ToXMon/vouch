import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { keccak256, stringToHex, toBytes, type Hash } from 'viem'
import { VOUCH_CONTRACT_ADDRESS, VOUCH_ABI } from '../lib/contract'
import { auditEvidence, type VerificationTypeApi, type EvidenceAuditResponse } from '../lib/api'

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

  const { writeContractAsync } = useWriteContract()
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

  const idParsed = commitmentId.trim() !== '' && /^\d+$/.test(commitmentId.trim())
  const canAudit = claim.trim().length >= 8 && evidence.trim().length >= 1 && !auditing

  const handleAudit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canAudit) return
    setError(null)
    setVerdict(null)
    setTxHash(null)
    setEvidenceHash(null)
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

  const verdictTone =
    verdict?.verdict === 'pass' || verdict?.verdict === 'supported' ? 'alert-success' :
    verdict?.verdict === 'fail' || verdict?.verdict === 'contradicted' ? 'alert-error' : 'alert-warning'

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
          />
        </div>

        {error && <div role="alert" className="alert alert-error">{error}</div>}

        <button type="submit" className="btn btn-primary btn-block" disabled={!canAudit}>
          {auditing ? (
            <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--primary-fg)', borderTopColor: 'transparent' }} /> AI auditing evidence…</>
          ) : (
            <>Run AI audit</>
          )}
        </button>
      </form>

      {verdict && (
        <div className={`card stack ${verdictTone}`} style={{ marginTop: '1rem' }}>
          <div className="verdict">
            <div className="verdict-block">
              <span className="eyebrow">AI Verdict</span>
              <div className={`verdict-value ${verdict.verdict}`}>{verdict.verdict}</div>
            </div>
            <div className="verdict-block" style={{ textAlign: 'right' }}>
              <span className="eyebrow">Confidence</span>
              <div className="verdict-value mono">{(verdict.confidence * 100).toFixed(0)}%</div>
            </div>
          </div>
          {verdict.reasoning && (
            <p style={{ fontSize: '0.86rem', lineHeight: 1.6, opacity: 0.92 }}>{verdict.reasoning}</p>
          )}

          {evidenceHash && (
            <>
              <div className="divider" style={{ margin: '0.5rem 0', opacity: 0.4 }} />
              <div className="stack-tight">
                <div>
                  <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>Evidence hash (keccak256)</div>
                  <div className="mono break-all" style={{ fontSize: '0.72rem', opacity: 0.9 }}>{evidenceHash}</div>
                </div>

                <button
                  type="button"
                  onClick={handleSubmitOnchain}
                  disabled={!idParsed || confirming}
                  className="btn btn-secondary btn-block"
                >
                  {confirming ? (
                    <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--text-muted)', borderTopColor: 'transparent' }} /> Confirming…</>
                  ) : confirmed && txHash ? (
                    <>✓ Submitted onchain</>
                  ) : (
                    <>Anchor onchain (submitEvidence)</>
                  )}
                </button>

                {txHash && (
                  <div className="mono break-all" style={{ fontSize: '0.72rem', opacity: 0.7 }}>tx: {txHash}</div>
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
