import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, isAddress, type Hash } from 'viem'
import {
  VOUCH_CONTRACT_ADDRESS,
  VOUCH_ABI,
  VerificationType,
  type VerificationTypeKey,
} from '../lib/contract'
import { generateSpec, type VerificationTypeApi } from '../lib/api'

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
  const [vType, setVType] = useState<number>(VerificationType.Photo)
  const [deadlineIdx, setDeadlineIdx] = useState(1)
  const [stakeMon, setStakeMon] = useState('0.1')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hash | null>(null)

  const { writeContractAsync } = useWriteContract()
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

  const valid =
    claim.trim().length >= 8 &&
    isAddress(counterparty) &&
    counterparty.toLowerCase() !== (address?.toLowerCase() ?? '') &&
    parseFloat(stakeMon) > 0 &&
    !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || !address) return
    setError(null)
    setTxHash(null)
    setSubmitting(true)

    try {
      // 1. Generate AI spec + spec_hash via Agent Runtime
      const vtypeOption = VTYPE_OPTIONS.find((o) => o.value === vType)!
      const { spec_hash } = await generateSpec({
        claim_text: claim.trim(),
        creator_address: address,
        counterparty_address: counterparty as `0x${string}`,
      })

      if (!spec_hash) throw new Error('No spec hash returned from agent runtime')

      // 2. Create commitment onchain — stake sent as msg.value
      const stakeWei = parseEther(stakeMon)
      const deadlineSeconds = DEADLINE_OPTIONS[deadlineIdx].seconds

      const hash = await writeContractAsync({
        address: VOUCH_CONTRACT_ADDRESS,
        abi: VOUCH_ABI,
        functionName: 'createCommitment',
        args: [spec_hash, vType, counterparty as `0x${string}`, deadlineSeconds],
        value: stakeWei,
      })

      setTxHash(hash)
      void spec_hash // spec content retained for evidence-audit step later; not displayed here
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create commitment'
      // Strip wagmi contract-revert noise for a cleaner message
      const short = msg.includes('revert') ? msg.slice(0, 200) : msg
      setError(short)
    } finally {
      setSubmitting(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="maxw-2xl">
        <div className="card text-center">
          <h1 className="mb-1">Connect your wallet to create a commitment</h1>
          <p className="text-muted">
            Vouch uses Para embedded wallets on Monad testnet. Connect to stake on your claim.
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

      <form onSubmit={handleSubmit} className="card stack">
        <div className="field">
          <label htmlFor="claim" className="label">Your claim</label>
          <textarea
            id="claim"
            className="textarea"
            placeholder="e.g. I will run a sub-20 5K by August 1, 2026. Loser owes 0.1 MON."
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={3}
            required
            minLength={8}
          />
          <p className="field-hint">{claim.length} chars · min 8</p>
        </div>

        <div className="field">
          <label htmlFor="counterparty" className="label">Counterparty address</label>
          <input
            id="counterparty"
            className="input mono"
            placeholder="0x…"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          {counterparty && !isAddress(counterparty) && (
            <p className="field-error">Enter a valid 0x address</p>
          )}
          {counterparty && address && counterparty.toLowerCase() === address.toLowerCase() && (
            <p className="field-error">Counterparty cannot be your own address</p>
          )}
        </div>

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
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="field-hint">
            {VTYPE_OPTIONS.find((o) => o.value === vType)?.hint}
          </p>
        </div>

        <div className="row" style={{ gap: '1rem' }}>
          <div className="field grow">
            <label htmlFor="deadline" className="label">Deadline</label>
            <select
              id="deadline"
              className="select"
              value={deadlineIdx}
              onChange={(e) => setDeadlineIdx(Number(e.target.value))}
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
              required
            />
            <p className="field-hint">Balance: {Number(balanceMon).toFixed(3)} MON</p>
          </div>
        </div>

        {error && (
          <div role="alert" className="alert alert-error">
            {error}
          </div>
        )}

        {txHash && (
          <div role="status" className="alert alert-success">
            <div style={{ fontWeight: 600 }}>
              {confirmed ? '✓ Commitment created' : confirming ? 'Confirming onchain…' : 'Transaction submitted'}
            </div>
            <div className="mono break-all" style={{ fontSize: '0.72rem', opacity: 0.8, marginTop: '0.3rem' }}>tx: {txHash}</div>
            {confirmed && (
              <Link to="/" className="mt-1" style={{ display: 'inline-block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--success)' }}>
                View on the public feed →
              </Link>
            )}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={!valid || confirming}>
          {submitting ? (
            <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--primary-fg)', borderTopColor: 'transparent' }} /> Drafting spec + signing…</>
          ) : confirming ? (
            <><span className="spin" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--primary-fg)', borderTopColor: 'transparent' }} /> Confirming…</>
          ) : (
            <>Lock {stakeMon || '0'} MON & create commitment</>
          )}
        </button>

        <p className="text-center text-dim" style={{ fontSize: '0.72rem' }}>
          The AI agent will draft a verifiable spec from your claim before the onchain tx.
        </p>
      </form>
    </div>
  )
}
