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
      <div className="container">
        <div className="card text-center">
          <h1 className="text-xl font-semibold">Connect your wallet to submit evidence</h1>
          <p className="mt-2 text-sm text-zinc-400">Only the commitment creator can submit evidence before the deadline.</p>
        </div>
      </div>
    )
  }

  const verdictTone =
    verdict?.verdict === 'verified' ? 'alert-success' :
    verdict?.verdict === 'rejected' ? 'alert-error' : 'alert-info'

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Submit evidence</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Paste a photo URL, screenshot, or text proof. The AI auditor checks it against the claim, then you can anchor the hash onchain.
        </p>
      </div>

      <form onSubmit={handleAudit} className="card space-y-5">
        <div>
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

        <div>
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

        <div>
          <label className="label">Verification type</label>
          <div className="flex flex-wrap gap-2">
            {VTYPE_API.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setVtype(opt.value)}
                aria-pressed={vtype === opt.value}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  vtype === opt.value
                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                    : 'border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
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

        <button type="submit" className="btn btn-primary w-full" disabled={!canAudit}>
          {auditing ? (
            <><span className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-emerald-900 border-t-transparent" aria-hidden="true" /> AI auditing evidence…</>
          ) : (
            <>Run AI audit</>
          )}
        </button>
      </form>

      {verdict && (
        <div className={`mt-4 card space-y-3 ${verdictTone}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider opacity-80">AI Verdict</div>
              <div className="text-lg font-bold capitalize">{verdict.verdict}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider opacity-80">Confidence</div>
              <div className="text-lg font-bold mono">{(verdict.confidence * 100).toFixed(0)}%</div>
            </div>
          </div>
          {verdict.reasoning && (
            <p className="text-sm leading-relaxed opacity-90">{verdict.reasoning}</p>
          )}

          {evidenceHash && (
            <div className="divider opacity-50" />
          )}

          {evidenceHash && (
            <div className="space-y-2">
              <div>
                <div className="text-xs uppercase tracking-wider opacity-80">Evidence hash (keccak256)</div>
                <div className="mono break-all text-[11px] opacity-90">{evidenceHash}</div>
              </div>

              <button
                type="button"
                onClick={handleSubmitOnchain}
                disabled={!idParsed || confirming}
                className="btn btn-secondary w-full"
              >
                {confirming ? (
                  <><span className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-zinc-500 border-t-transparent" aria-hidden="true" /> Confirming…</>
                ) : confirmed && txHash ? (
                  <>✓ Submitted onchain</>
                ) : (
                  <>Anchor onchain (submitEvidence)</>
                )}
              </button>

              {txHash && (
                <div className="mono break-all text-[11px] opacity-70">tx: {txHash}</div>
              )}

              {!idParsed && commitmentId && (
                <p className="text-xs text-rose-400">Enter a valid numeric commitment ID to submit onchain.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
