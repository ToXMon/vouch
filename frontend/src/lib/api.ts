import axios, { type AxiosInstance } from 'axios'

/**
 * Agent Runtime API client (FastAPI at VITE_AGENT_URL).
 * Types aligned to backend Pydantic models (agents/runtime/main.py).
 */

const AGENT_URL = (import.meta.env.VITE_AGENT_URL || '').replace(/\/$/, '')

export const api: AxiosInstance = axios.create({
  baseURL: AGENT_URL,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
})

export interface SpecRequest {
  claim_text: string
  creator_address: string
  counterparty_address: string
}

export interface SpecResponse {
  spec: Record<string, unknown>
  spec_hash: `0x${string}`
}

export type VerificationTypeApi = 'photo' | 'web' | 'location' | 'peer_sign' | 'api'

export interface EvidenceAuditRequest {
  claim: string
  evidence_url: string | null
  verification_type: VerificationTypeApi
  strictness?: 'low' | 'medium' | 'high'
}

export interface EvidenceAuditResponse {
  verdict: 'pass' | 'fail' | 'uncertain' | 'supported' | 'contradicted' | 'mixed' | 'insufficient'
  confidence: number
  sources: unknown[]
  attestation: string
  error: string | null
}

export interface DisputeAdjudicateRequest {
  commitment: Record<string, unknown>
  evidence: Record<string, unknown>
  auditor_verdict: Record<string, unknown>
  dispute_reason: string | null
}

export interface DisputeAdjudicateResponse {
  ruling: 'creator_wins' | 'challenger_wins' | 'insufficient_evidence' | 'insufficient'
  reasoning: string
  confidence: number
  method: string
}

export interface HealthResponse {
  status: string
  venice_configured: boolean
  threews_configured: boolean
}

/** Generate a commitment spec from a claim. */
export async function generateSpec(req: SpecRequest): Promise<SpecResponse> {
  const { data } = await api.post<SpecResponse>('/api/commitments/spec', req)
  return data
}

/** Audit submitted evidence against a claim. */
export async function auditEvidence(req: EvidenceAuditRequest): Promise<EvidenceAuditResponse> {
  const { data } = await api.post<EvidenceAuditResponse>('/api/evidence/audit', req)
  return data
}

/** Adjudicate a disputed commitment. */
export async function adjudicateDispute(req: DisputeAdjudicateRequest): Promise<DisputeAdjudicateResponse> {
  const { data } = await api.post<DisputeAdjudicateResponse>('/api/dispute/adjudicate', req)
  return data
}

/** Health check the Agent Runtime. */
export async function checkHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/api/health')
  return data
}

/* ─── KV persistence (spec + evidence store/retrieve via worker) ────── */

export interface StoredSpec {
  spec: Record<string, unknown> & {
    claim_text?: string
    verification_type?: string
    success_criteria?: string[]
    parties?: string[]
    deadline_iso?: string
    stake_amount_mon?: number | string
    spec_version?: number | string
  }
  claim_text: string
  created_at: string
}

export interface StoredEvidence {
  evidenceHash: string
  commitmentId?: number | string | null
  verdict: EvidenceAuditResponse['verdict']
  confidence: number
  sources: unknown[]
  attestation: string
  claim?: string
  reasoning?: string
  stored_at: string
}

/** Store a spec + claim text in KV after onchain tx confirms. */
export async function storeSpec(specHash: string, spec: Record<string, unknown>, claimText: string): Promise<{ ok: boolean; persisted: boolean }> {
  try {
    const resp = await fetch('/api/spec/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specHash, spec, claim_text: claimText }),
    })
    if (!resp.ok) return { ok: false, persisted: false }
    return await resp.json()
  } catch {
    return { ok: false, persisted: false }
  }
}

/** Retrieve a spec + claim text from KV by hash. Returns null if not found. */
export async function fetchSpec(specHash: string): Promise<StoredSpec | null> {
  try {
    const resp = await fetch(`/api/spec/${specHash}`)
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

/** Store an evidence verdict in KV after onchain submit confirms. */
export async function storeEvidence(payload: {
  evidenceHash: string
  commitmentId?: number | string | null
  verdict: EvidenceAuditResponse['verdict']
  confidence: number
  sources: unknown[]
  attestation: string
  claim?: string
  reasoning?: string
}): Promise<{ ok: boolean; persisted: boolean }> {
  try {
    const resp = await fetch('/api/evidence/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) return { ok: false, persisted: false }
    return await resp.json()
  } catch {
    return { ok: false, persisted: false }
  }
}

/** Retrieve an evidence verdict from KV by hash. Returns null if not found. */
export async function fetchEvidence(evidenceHash: string): Promise<StoredEvidence | null> {
  try {
    const resp = await fetch(`/api/evidence/${evidenceHash}`)
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}
