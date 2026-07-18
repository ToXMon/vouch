import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseEther, isAddress, type Hash } from 'viem'
import {
  VOUCH_CONTRACT_ADDRESS,
  VOUCH_ABI,
  VerificationType,
  type VerificationTypeKey,
} from '../lib/contract'
import { generateSpec, storeSpec, type VerificationTypeApi, type SpecResponse } from '../lib/api'

interface Props {
  address: `0x${string}` | undefined
  isConnected: boolean
  balanceMon: string
}

const VTYPE_OPTIONS: { key: VerificationTypeKey; value: number; label: string; hint: string; api: VerificationTypeApi }[] = [
  { key: 'Photo', value: VerificationType.Photo, label: 'Photo', hint: 'Image proof (receipt, photo at location)', api: 'photo' },
  { key: 'Web', value: VerificationType.Web, label: 'Web', hint: 'URL / screenshot of an online source', api: 'web' },
  { key: 'Location', value: VerificationType.Location, label: 'Location', hint: 'Geo check-in at a place', api: 'location' },
  { key: 'PeerSign', value: VerificationType.PeerSign, label: 'Peer Sign', hint: 'Counterparty co-signs the claim', api: 'peer_sign' },
  { key: 'API', value: VerificationType.API, label: 'API', hint: 'Third-party API attestation', api: 'api' },
]

const DEADLINE_OPTIONS: { label: string; seconds: bigint }[] = [
  { label: '1 hour', seconds: 3600n },
  { label: '1 day', seconds: 86_400n },
  { label: '3 days', seconds: 259_200n },
  { label: '7 days', seconds: 604_800n },
]

export default function CreateCommitment({ address, isConnected, balanceMon }: Props) {
  const [claim, setClaim] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [showCounterpartyHelp, setShowCounterpartyHelp] = useState(false)
  const [vType, setVType] = useState<number>(VerificationType.Photo)
  const [deadlineIdx, setDeadlineIdx] = useState(1)
  const [stakeMon, setStakeMon] = useState('0.1')

  // Two-phase flow
  const [generating, setGenerating] = useState(false)
  const [specResp, setSpecResp] = useState<SpecResponse | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hash | null>(null)
  const [stored, setStored] = useState(false)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

  const claimValid = claim.trim().length >= 8
  const counterpartyValid =
    isAddress(counterparty) &&
    counterparty.toLowerCase() !== (address?.toLowerCase() ?? '')
  const stakeValid = parseFloat(stakeMon) > 0
  const canGenerate = claimValid && counterpartyValid && !generating
  const canLock = !!specResp && stakeValid && !submitting && !confirming

  // ── Gas estimate (recomputed when inputs change) ───────────────
  const [gasEstimate, setGasEstimate] = useState<bigint | null>(null)
  useEffect(() => {
    let cancelled = false
    async function estimate() {
      if (!specResp || !stakeValid || !publicClient) { setGasEstimate(null); return }
      try {
        const stakeWei = parseEther(stakeMon)
        const deadlineSeconds = DEADLINE_OPTIONS[deadlineIdx].seconds
        const est = await publicClient.estimateContractTotalGas({
          address: VOUCH_CONTRACT_ADDRESS,
          abi: VOUCH_ABI,
          functionName: 'createCommitment',
          args: [specResp.spec_hash, vType, counterparty as `0x${string}`, deadlineSeconds],
          account: address as `0x${string}`,
          value: stakeWei,
        } as never).catch(() => null)
        if (!cancelled) setGasEstimate(est)
      } catch {
        if (!cancelled) setGasEstimate(null)
      }
    }
    estimate()
    return () => { cancelled = true }
  }, [specResp, stakeMon, deadlineIdx, vType, counterparty, address, stakeValid, publicClient])

  // ── Auto-store spec in KV once tx confirms ──────────────────────
  useEffect(() => {
    if (!confirmed || !txHash || !specResp || stored) return
    storeSpec(specResp.spec_hash, specResp.spec, claim.trim()).then(() => setStored(true))
  }, [confirmed, txHash, specResp, claim, stored])

  const handlePasteCounterparty = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const trimmed = text.trim()
      if (trimmed) setCounterparty(trimmed)
    } catch {
      // clipboard read blocked — user types manually
    }
  }

  const handleGenerateSpec = async () => {
    if (!canGenerate) return
    setGenError(null)
    setSpecResp(null)
    setGenerating(true)
    try {
      const resp = await generateSpec({
        claim_text: claim.trim(),
        creator_address: address ?? '',
        counterparty_address: counterparty as `0x${string}`,
      })
      if (!resp.spec_hash) throw new Error('No spec hash returned')
      setSpecResp(resp)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Spec generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const handleLockStake = async () => {
    if (!canLock || !address || !specResp) return
    setError(null)
    setTxHash(null)
    setStored(false)
    setSubmitting(true)
    try {
      const stakeWei = parseEther(stakeMon)
      const deadlineSeconds = DEADLINE_OPTIONS[deadlineIdx].seconds
      const hash = await writeContractAsync({
        address: VOUCH_CONTRACT_ADDRESS,
        abi: VOUCH_ABI,
        functionName: 'createCommitment',
        args: [specResp.spec_hash, vType, counterparty as `0x${string}`, deadlineSeconds],
        value: stakeWei,
      })
      setTxHash(hash)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create commitment'
      setError(msg.includes('revert') ? msg.slice(0, 200) : msg)
    } finally {
      setSubmitting(false)
    }
  }

  const resetSpec = () => {
    setSpecResp(null)
    setGenError(null)
    setTxHash(null)
    setStored(false)
  }

  if (!isConnected) {
    return (
      <div className="maxw-2xl">
        <div className="card text-center">
          <h1 className="mb-1">Connect your wallet to create a commitment</h1>
          <p className="text-muted">
            Vouch uses Para embedded wallets on Monad testnet. Sign in with email, social, or connect MetaMask to stake on your claim.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="maxw-2xl">
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="page-title">Create a commitment</h1>
          <p className="page-sub">
            Stake MON on a personal claim. The AI agent drafts a verifiable spec, then your stake locks onchain.
          </p>
        </div>
      </div>

      {/* ── Phase 1: Claim + counterparty + Generate Spec ────── */}
      <div className="card stack">
        <div className="field">
          <label htmlFor="claim" className="label">Your claim</label>
          <textarea
            id="claim"
            className="textarea textarea-lg"
            placeholder="e.g. I will run a sub-20 5K by August 1, 2026. Loser owes 0.1 MON."
            value={claim}
            onChange={(e) => { setClaim(e.target.value); resetSpec() }}
            rows={3}
            required
            minLength={8}
            disabled={!!specResp && !txHash}
          />
          <p className="field-hint">{claim.length} chars · min 8</p>
        </div>

        <div className="field">
          <div className="label-row">
            <label htmlFor="counterparty" className="label">Who is on the other side?</label>
            <button
              type="button"
              className="label-help-btn"
              onClick={() => setShowCounterpartyHelp(!showCounterpartyHelp)}
              aria-label="What is a counterparty?"
            >?</button>
          </div>
          {showCounterpartyHelp && (
            <div className="field-help-card">
              <p><strong>The counterparty</strong> is the person you are making this commitment with. They can challenge your claim if they disagree.</p>
              <p style={{ marginTop: '0.5rem' }}><strong>How to find their address:</strong> Ask them to copy their wallet address from Vouch or MetaMask, then paste it below.</p>
              <p style={{ marginTop: '0.5rem' }} className="text-dim"><em>For testing: any valid Monad testnet address works — including your own second wallet.</em></p>
            </div>
          )}
          <div className="input-with-action">
            <input
              id="counterparty"
              className="input mono"
              placeholder="Paste their 0x address here…"
              value={counterparty}
              onChange={(e) => { setCounterparty(e.target.value); resetSpec() }}
              spellCheck={false}
              autoComplete="off"
              disabled={!!specResp && !txHash}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handlePasteCounterparty}
              title="Paste from clipboard"
              disabled={!!specResp && !txHash}
            >Paste</button>
          </div>
          {counterparty && isAddress(counterparty) && counterparty.toLowerCase() !== (address?.toLowerCase() ?? '') && (
            <p className="field-success">✓ Valid address: {counterparty.slice(0, 6)}…{counterparty.slice(-4)}</p>
          )}
          {counterparty && !isAddress(counterparty) && (
            <p className="field-error">That does not look like a valid wallet address. It should be 42 characters starting with 0x.</p>
          )}
          {counterparty && address && counterparty.toLowerCase() === address.toLowerCase() && (
            <p className="field-error">You cannot be your own counterparty. Paste a different wallet address.</p>
          )}
          {!counterparty && (
            <p className="field-hint">The person who can challenge your claim. Paste their Monad testnet address.</p>
          )}
        </div>

        {genError && <div role="alert" className="alert alert-error">{genError}</div>}

        {!specResp && (
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={handleGenerateSpec}
            disabled={!canGenerate}
          >
            {generating ? (
              <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--text-muted)', borderTopColor: 'transparent' }} /> Generating AI spec…</>
            ) : (
              <>✨ Generate AI spec</>
            )}
          </button>
        )}
      </div>

      {/* ── AI Spec Preview Panel ────────────────────────────── */}
      {specResp && (
        <div className="card stack spec-preview">
          <div className="row-between">
            <div className="eyebrow">AI Spec Preview · Generated by Venice AI</div>
            {!txHash && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetSpec}>Edit claim</button>
            )}
          </div>
          {typeof specResp.spec?.claim_text === 'string' && (
            <p className="spec-preview-claim">{String(specResp.spec.claim_text)}</p>
          )}
          <dl className="detail-list">
            {typeof specResp.spec?.verification_type === 'string' && (
              <div className="detail-row">
                <dt className="detail-label">Verification type</dt>
                <dd className="detail-value"><span className="badge badge-neutral">{String(specResp.spec.verification_type)}</span></dd>
              </div>
            )}
            {Array.isArray(specResp.spec?.success_criteria) && (specResp.spec.success_criteria as unknown[]).length > 0 && (
              <div className="detail-row">
                <dt className="detail-label">Success criteria</dt>
                <dd className="detail-value">
                  <ul className="spec-list">
                    {(specResp.spec.success_criteria as unknown[]).map((c, i) => (
                      <li key={i}>{String(c)}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            <div className="detail-row">
              <dt className="detail-label">Spec hash (SHA-256)</dt>
              <dd className="detail-value mono break-all" style={{ fontSize: '0.72rem' }}>{specResp.spec_hash}</dd>
            </div>
          </dl>
          <p className="text-dim" style={{ fontSize: '0.72rem' }}>
            This spec will be anchored onchain by its hash. After your tx confirms, the readable text is auto-stored so the feed can show it.
          </p>
        </div>
      )}

      {/* ── Phase 2: Configure + Lock Stake ─────────────────── */}
      {specResp && (
        <div className="card stack">
          <div className="section-label">Lock your stake</div>

          <div className="field">
            <label className="label">Verification type</label>
            <div className="choice-grid">
              {VTYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setVType(opt.value)}
                  aria-pressed={vType === opt.value}
                  className="choice"
                  title={opt.hint}
                  disabled={!!txHash}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="field-hint">{VTYPE_OPTIONS.find((o) => o.value === vType)?.hint}</p>
          </div>

          <div className="row" style={{ gap: '1rem' }}>
            <div className="field grow">
              <label htmlFor="deadline" className="label">Deadline</label>
              <select
                id="deadline"
                className="select"
                value={deadlineIdx}
                onChange={(e) => setDeadlineIdx(Number(e.target.value))}
                disabled={!!txHash}
              >
                {DEADLINE_OPTIONS.map((opt, i) => (
                  <option key={i} value={i}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="field grow">
              <label htmlFor="stake" className="label">Stake (MON)</label>
              <input
                id="stake"
                className="input"
                type="number"
                step="0.001"
                min="0"
                value={stakeMon}
                onChange={(e) => setStakeMon(e.target.value)}
                disabled={!!txHash}
                required
              />
              <p className="field-hint">Balance: {Number(balanceMon).toFixed(3)} MON</p>
            </div>
          </div>

          {gasEstimate !== null && (
            <p className="text-dim" style={{ fontSize: '0.78rem' }}>
              Est. gas: <span className="mono">{gasEstimate.toString()}</span> units
            </p>
          )}

          {error && (
            <div role="alert" className="alert alert-error">{error}</div>
          )}

          {txHash && (
            <div role="status" className="alert alert-success">
              <div style={{ fontWeight: 600 }}>
                {confirmed ? '✓ Commitment created' : confirming ? 'Confirming onchain…' : 'Transaction submitted'}
              </div>
              <div className="mono break-all" style={{ fontSize: '0.72rem', opacity: 0.8, marginTop: '0.3rem' }}>tx: {txHash}</div>
              {confirmed && (
                <>
                  {stored && <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--success)' }}>✓ Spec stored — feed will display your claim</div>}
                  <Link to="/" className="mt-1" style={{ display: 'inline-block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--success)' }}>
                    View on the public feed →
                  </Link>
                </>
              )}
            </div>
          )}

          {!txHash && (
            <button type="button" className="btn btn-primary btn-block" onClick={handleLockStake} disabled={!canLock}>
              {submitting ? (
                <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--primary-fg)', borderTopColor: 'transparent' }} /> Signing…</>
              ) : confirming ? (
                <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--primary-fg)', borderTopColor: 'transparent' }} /> Confirming…</>
              ) : (
                <>Lock {stakeMon || '0'} MON & create commitment</>
              )}
            </button>
          )}
        </div>
      )}

      <p className="text-center text-dim" style={{ fontSize: '0.72rem' }}>
        The AI agent drafts a verifiable spec from your claim before the onchain tx, then auto-stores it after confirmation.
      </p>
    </div>
  )
}
