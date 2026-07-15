import { createPublicClient, createWalletClient, custom, http, type Hash, type Log } from 'viem'
import { monadTestnet } from 'viem/chains'

/**
 * Vouch.sol contract interaction helpers.
 *
 * Minimal ABI matching contracts/src/Vouch.sol. Replace VOUCH_ABI with the
 * full ABI from `forge build` output (out/Vouch.sol/Vouch.json) after deploy.
 */

export const VOUCH_CONTRACT_ADDRESS = (import.meta.env.VITE_VOUCH_CONTRACT_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`

export const MONAD_RPC_URL = import.meta.env.VITE_MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz'

/** VerificationType enum (uint8) — order MUST match Vouch.sol */
export const VerificationType = {
  Photo: 0,
  Web: 1,
  Location: 2,
  PeerSign: 3,
  API: 4,
} as const
export type VerificationTypeKey = keyof typeof VerificationType

/** Status enum (uint8) — order MUST match Vouch.sol */
export const CommitmentStatus = {
  Active: 0,
  Challenged: 1,
  Settled: 2,
  Expired: 3,
} as const
export type CommitmentStatusKey = keyof typeof CommitmentStatus

export interface CommitmentStruct {
  creator: `0x${string}`
  counterparty: `0x${string}`
  specHash: `0x${string}`
  vType: number
  stake: bigint
  deadline: bigint
  status: number
  evidenceHash: `0x${string}`
}

/**
 * Minimal ABI. Will be replaced with the full ABI from forge build output
 * after deploy — this is enough to drive the UI end-to-end.
 */
export const VOUCH_ABI = [
  {
    type: 'function',
    name: 'createCommitment',
    stateMutability: 'payable',
    inputs: [
      { name: 'specHash', type: 'bytes32' },
      { name: 'vType', type: 'uint8' },
      { name: 'counterparty', type: 'address' },
      { name: 'deadlineSeconds', type: 'uint256' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'submitEvidence',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'challenge',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'settle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'creatorWins', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getCommitment',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        name: 'commitment',
        type: 'tuple',
        components: [
          { name: 'creator', type: 'address' },
          { name: 'counterparty', type: 'address' },
          { name: 'specHash', type: 'bytes32' },
          { name: 'vType', type: 'uint8' },
          { name: 'stake', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'evidenceHash', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'isInChallengeWindow',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'CommitmentCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'counterparty', type: 'address', indexed: true },
      { name: 'specHash', type: 'bytes32', indexed: false },
      { name: 'vType', type: 'uint8', indexed: false },
      { name: 'stake', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EvidenceSubmitted',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Challenged',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'challenger', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Settled',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'winner', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'disputed', type: 'bool', indexed: false },
    ],
  },
] as const

export interface CommitmentCreatedLog {
  id: bigint
  creator: `0x${string}`
  counterparty: `0x${string}`
  specHash: `0x${string}`
  vType: number
  stake: bigint
  deadline: bigint
  transactionHash: `0x${string}`
  blockNumber: bigint
}

/** Public client for read-only calls (no wallet required). */
export function getPublicClient() {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(MONAD_RPC_URL),
  })
}

/** Wallet client scoped to the connected Para wallet. */
export function getWalletClient(provider: EIP1193Provider) {
  return createWalletClient({
    chain: monadTestnet,
    transport: custom(provider),
  })
}

export type EIP1193Provider = { request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown> }

/** Read a full commitment by ID. */
export async function fetchCommitment(id: bigint): Promise<CommitmentStruct> {
  const client = getPublicClient()
  const data = await client.readContract({
    address: VOUCH_CONTRACT_ADDRESS,
    abi: VOUCH_ABI,
    functionName: 'getCommitment',
    args: [id],
  })
  return data as unknown as CommitmentStruct
}

/** Check if a commitment is currently in its 24h challenge window. */
export async function fetchIsInChallengeWindow(id: bigint): Promise<boolean> {
  const client = getPublicClient()
  const data = await client.readContract({
    address: VOUCH_CONTRACT_ADDRESS,
    abi: VOUCH_ABI,
    functionName: 'isInChallengeWindow',
    args: [id],
  })
  return data as boolean
}

/** Fetch all CommitmentCreated logs (drives the public feed). */
export async function fetchCommitmentCreatedLogs(fromBlock = 0n): Promise<CommitmentCreatedLog[]> {
  const client = getPublicClient()
  const logs = await client.getLogs({
    address: VOUCH_CONTRACT_ADDRESS,
    event: VOUCH_ABI[7] as never, // CommitmentCreated
    fromBlock,
    toBlock: 'latest',
  })
  return logs.map((log: Log) => ({
    id: (log.args as Record<string, unknown>).id as bigint,
    creator: (log.args as Record<string, unknown>).creator as `0x${string}`,
    counterparty: (log.args as Record<string, unknown>).counterparty as `0x${string}`,
    specHash: (log.args as Record<string, unknown>).specHash as `0x${string}`,
    vType: Number((log.args as Record<string, unknown>).vType),
    stake: (log.args as Record<string, unknown>).stake as bigint,
    deadline: (log.args as Record<string, unknown>).deadline as bigint,
    transactionHash: log.transactionHash as `0x${string}`,
    blockNumber: log.blockNumber ?? 0n,
  }))
}

/** Create a new commitment (payable — sends stake as msg.value). */
export async function createCommitmentTx(
  provider: EIP1193Provider,
  account: `0x${string}`,
  args: {
    specHash: `0x${string}`
    vType: number
    counterparty: `0x${string}`
    deadlineSeconds: bigint
    stakeWei: bigint
  }
): Promise<Hash> {
  const walletClient = getWalletClient(provider)
  const hash = await walletClient.writeContract({
    account,
    address: VOUCH_CONTRACT_ADDRESS,
    abi: VOUCH_ABI,
    functionName: 'createCommitment',
    args: [args.specHash, args.vType, args.counterparty, args.deadlineSeconds],
    value: args.stakeWei,
    chain: monadTestnet,
  })
  return hash
}

/** Submit evidence hash for a commitment (creator only, before deadline). */
export async function submitEvidenceTx(
  provider: EIP1193Provider,
  account: `0x${string}`,
  id: bigint,
  evidenceHash: `0x${string}`
): Promise<Hash> {
  const walletClient = getWalletClient(provider)
  return walletClient.writeContract({
    account,
    address: VOUCH_CONTRACT_ADDRESS,
    abi: VOUCH_ABI,
    functionName: 'submitEvidence',
    args: [id, evidenceHash],
    chain: monadTestnet,
  })
}

/** Challenge a commitment (counterparty only, during challenge window). */
export async function challengeTx(
  provider: EIP1193Provider,
  account: `0x${string}`,
  id: bigint
): Promise<Hash> {
  const walletClient = getWalletClient(provider)
  return walletClient.writeContract({
    account,
    address: VOUCH_CONTRACT_ADDRESS,
    abi: VOUCH_ABI,
    functionName: 'challenge',
    args: [id],
    chain: monadTestnet,
  })
}

/** Settle a commitment (anyone after window closes; adjudicator if challenged). */
export async function settleTx(
  provider: EIP1193Provider,
  account: `0x${string}`,
  id: bigint,
  creatorWins: boolean
): Promise<Hash> {
  const walletClient = getWalletClient(provider)
  return walletClient.writeContract({
    account,
    address: VOUCH_CONTRACT_ADDRESS,
    abi: VOUCH_ABI,
    functionName: 'settle',
    args: [id, creatorWins],
    chain: monadTestnet,
  })
}

/** wei → MON display string with 4 decimals. */
export function formatMon(wei: bigint, decimals = 18): string {
  const whole = wei / 10n ** BigInt(decimals)
  const fraction = wei % 10n ** BigInt(decimals)
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '')
  return fractionStr ? `${whole.toString()}.${fractionStr}` : whole.toString()
}

/** Shorten 0x… address for display: 0x1234…abcd */
export function shortAddr(addr: `0x${string}` | string, head = 6, tail = 4): string {
  if (!addr) return ''
  if (addr.length <= head + tail + 2) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

/** Map uint8 status → human label. */
export function statusLabel(status: number): CommitmentStatusKey {
  const entries = Object.entries(CommitmentStatus) as [CommitmentStatusKey, number][]
  return (entries.find(([, v]) => v === status)?.[0] ?? 'Active')
}

/** Map uint8 vType → human label. */
export function vTypeLabel(vType: number): VerificationTypeKey {
  const entries = Object.entries(VerificationType) as [VerificationTypeKey, number][]
  return (entries.find(([, v]) => v === vType)?.[0] ?? 'Photo')
}

/** Seconds remaining → compact countdown "23h 59m" / "4m 12s" / "expired". */
export function countdown(deadlineSeconds: number): string {
  if (deadlineSeconds <= 0) return 'expired'
  const h = Math.floor(deadlineSeconds / 3600)
  const m = Math.floor((deadlineSeconds % 3600) / 60)
  const s = deadlineSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
