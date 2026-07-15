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
