// Vouch Combined Worker -- serves React app + handles API (Venice AI + three.ws + KV spec/evidence persistence)
const VENICE_URL = 'https://api.venice.ai/api/v1/chat/completions';
const THREEWS_URL = 'https://three.ws/api/x402/fact-check';
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/ToXMon/vouch@c1717569c5b55729bae1a09eace5d05f45bb71c1/frontend/dist';

// Defaults — overridable via env vars (VOUCH_CONTRACT_ADDRESS, MONAD_RPC_URL)
const DEFAULT_MONAD_RPC = 'https://testnet-rpc.monad.xyz';
const DEFAULT_VOUCH_CONTRACT = '0x2471870511267d1eE09c08460D95Eaf5F5dE00D4';
const ZERO_BYTES32 = '0x' + '0'.repeat(64);
const ZERO_ADDR = '0x' + '0'.repeat(40);

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

async function callVenice(apiKey, model, sys, user) {
  const r = await fetch(VENICE_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.3, max_tokens: 800 }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Venice ' + r.status + ': ' + t.substring(0, 200)); }
  return (await r.json()).choices[0].message.content;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return '0x' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractJson(raw) {
  let s = raw.trim();
  const si = s.indexOf('{');
  const ei = s.lastIndexOf('}');
  if (si >= 0 && ei > si) s = s.substring(si, ei + 1);
  return JSON.parse(s);
}

// ── KV helpers (graceful no-op when SPECS not bound) ───────────────
async function getSpec(env, hash) {
  if (!env.SPECS) return null;
  const raw = await env.SPECS.get(hash);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function putSpec(env, hash, data) {
  if (!env.SPECS) return false;
  await env.SPECS.put(hash, JSON.stringify(data));
  return true;
}

async function getEvidence(env, hash) {
  if (!env.SPECS) return null;
  const raw = await env.SPECS.get('evidence:' + hash);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function putEvidence(env, hash, data) {
  if (!env.SPECS) return false;
  await env.SPECS.put('evidence:' + hash, JSON.stringify(data));
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const veniceKey = env.VENICE_API_KEY || '';
    const threewsKey = env.THREE_WS_API_KEY || '';
    const MONAD_RPC = env.MONAD_RPC_URL || DEFAULT_MONAD_RPC;
    const VOUCH_CONTRACT = env.VOUCH_CONTRACT_ADDRESS || DEFAULT_VOUCH_CONTRACT;

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

    // ── KV: Store spec ───────────────────────────────────────────
    if (path === '/api/spec/store' && request.method === 'POST') {
      try {
        const body = await request.json();
        const specHash = body.specHash;
        if (!specHash || !body.spec) {
          return new Response(JSON.stringify({ error: 'specHash and spec required' }), { status: 400, headers: cors() });
        }
        const ok = await putSpec(env, specHash, {
          spec: body.spec,
          claim_text: body.claim_text || (body.spec && body.spec.claim_text) || '',
          created_at: new Date().toISOString(),
        });
        return new Response(JSON.stringify({ ok: true, persisted: ok }), { headers: cors() });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors() });
      }
    }

    // ── KV: Retrieve spec by hash ────────────────────────────────
    const specMatch = path.match(/^\/api\/spec\/(0x[a-fA-F0-9]+)$/);
    if (specMatch && request.method === 'GET') {
      const hash = specMatch[1];
      const data = await getSpec(env, hash);
      if (!data) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors() });
      return new Response(JSON.stringify(data), { headers: cors() });
    }

    // ── KV: Store evidence verdict ───────────────────────────────
    if (path === '/api/evidence/store' && request.method === 'POST') {
      try {
        const body = await request.json();
        const evidenceHash = body.evidenceHash;
        if (!evidenceHash) {
          return new Response(JSON.stringify({ error: 'evidenceHash required' }), { status: 400, headers: cors() });
        }
        const ok = await putEvidence(env, evidenceHash, {
          evidenceHash,
          commitmentId: body.commitmentId ?? null,
          verdict: body.verdict,
          confidence: body.confidence,
          sources: body.sources || [],
          attestation: body.attestation || '',
          claim: body.claim || '',
          reasoning: body.reasoning || '',
          stored_at: new Date().toISOString(),
        });
        return new Response(JSON.stringify({ ok: true, persisted: ok }), { headers: cors() });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors() });
      }
    }

    // ── KV: Retrieve evidence verdict by hash ────────────────────
    const evMatch = path.match(/^\/api\/evidence\/(0x[a-fA-F0-9]+)$/);
    if (evMatch && request.method === 'GET') {
      const hash = evMatch[1];
      const data = await getEvidence(env, hash);
      if (!data) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors() });
      return new Response(JSON.stringify(data), { headers: cors() });
    }

    // ── API: Feed (eth_call to read all commitments, enriched with specs + evidence) ───
    if (path === '/api/feed') {
      try {
        // Read nextId() via eth_call (selector: 0x61b8ce8c)
        const idResp = await fetch(MONAD_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: VOUCH_CONTRACT, data: '0x61b8ce8c' }, 'latest'] })
        });
        const idData = await idResp.json();
        const nextId = parseInt(idData.result || '0x0', 16);
        if (nextId === 0) return new Response(JSON.stringify({ commitments: [] }), { headers: cors() });

        // Batch read each commitment via eth_call to getCommitment(uint256) (selector: 0x69bcdb7d)
        const commitments = [];
        const maxRead = Math.min(nextId, 50);
        const batch = [];
        for (let i = 0; i < maxRead; i++) {
          const arg = i.toString(16).padStart(64, '0');
          batch.push({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [{ to: VOUCH_CONTRACT, data: '0x69bcdb7d' + arg }, 'latest'] });
        }
        const batchResp = await fetch(MONAD_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch)
        });
        const batchData = await batchResp.json();
        const results = Array.isArray(batchData) ? batchData : [batchData];

        for (let i = 0; i < results.length; i++) {
          const hex = results[i].result;
          if (!hex || hex === '0x' || hex.length < 10) continue;
          // ABI struct (8 slots × 64 hex chars each, after '0x' prefix):
          //   slot0: hex[2:66]     creator (address — last 40 chars = hex[26:66])
          //   slot1: hex[66:130]   counterparty (address — hex[90:130])
          //   slot2: hex[130:194]  specHash (bytes32)
          //   slot3: hex[194:258]  vType (uint8 — hex[256:258])
          //   slot4: hex[258:322]  stake (uint256)
          //   slot5: hex[322:386]  deadline (uint256)
          //   slot6: hex[386:450]  status (uint8 — hex[448:450])
          //   slot7: hex[450:514]  evidenceHash (bytes32)
          const creator = '0x' + hex.slice(26, 66);
          if (creator === ZERO_ADDR) continue;
          const counterparty = '0x' + hex.slice(90, 130);
          const specHash = '0x' + hex.slice(130, 194);
          const vType = parseInt(hex.slice(256, 258), 16);
          const stakeHex = hex.slice(258, 322);
          const deadlineHex = hex.slice(322, 386);
          const status = parseInt(hex.slice(448, 450), 16);
          const evidenceHash = '0x' + hex.slice(450, 514);
          commitments.push({
            id: i,
            creator,
            counterparty,
            specHash,
            vType,
            status,
            stake: BigInt('0x' + stakeHex).toString(),
            deadline: BigInt('0x' + deadlineHex).toString(),
            evidenceHash,
          });
        }

        // ── Enrich with specs from KV (parallel) ─────────────────
        if (env.SPECS && commitments.length > 0) {
          const specResults = await Promise.all(
            commitments.map(c => env.SPECS.get(c.specHash).catch(() => null))
          );
          commitments.forEach((c, i) => {
            const raw = specResults[i];
            if (raw) {
              try {
                const parsed = JSON.parse(raw);
                c.claim_text = parsed.claim_text || (parsed.spec && parsed.spec.claim_text) || null;
                c.spec = parsed.spec || null;
              } catch { /* ignore parse errors */ }
            }
          });

          // ── Enrich with evidence verdicts from KV (parallel) ────
          await Promise.all(commitments.map(async (c) => {
            if (c.evidenceHash && c.evidenceHash !== ZERO_BYTES32) {
              const evRaw = await env.SPECS.get('evidence:' + c.evidenceHash).catch(() => null);
              if (evRaw) {
                try { c.evidence = JSON.parse(evRaw); } catch { /* ignore */ }
              }
            }
          }));
        }

        return new Response(JSON.stringify({ commitments }), { headers: cors() });
      } catch (e) {
        return new Response(JSON.stringify({ commitments: [], error: String(e) }), { status: 500, headers: cors() });
      }
    }

    if (path === '/api/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        venice_configured: !!veniceKey,
        threews_configured: !!threewsKey,
        kv_configured: !!env.SPECS,
        contract: VOUCH_CONTRACT,
        rpc: MONAD_RPC,
      }), { headers: cors() });
    }

    // ── API: Generate commitment spec (auto-stores in KV) ────────
    if (path === '/api/commitments/spec' && request.method === 'POST') {
      try {
        const body = await request.json();
        const sys = 'You are the Vouch AI Architect. Generate a commitment spec as JSON with keys: claim_text, verification_type (one of: photo, web, location, peer_sign, api), parties (array of addresses), deadline_iso, stake_amount_mon, success_criteria (array of strings), spec_version. Return ONLY valid JSON, no markdown.';
        const user = JSON.stringify({ claim: body.claim_text, creator: body.creator_address, counterparty: body.counterparty_address });
        const raw = await callVenice(veniceKey, 'llama-3.3-70b', sys, user);
        const spec = extractJson(raw);
        const hash = await sha256Hex(JSON.stringify(spec));

        // Auto-store in KV so the feed/detail pages can render the human-readable claim
        await putSpec(env, hash, {
          spec,
          claim_text: body.claim_text,
          created_at: new Date().toISOString(),
        });

        return new Response(JSON.stringify({ spec, spec_hash: hash }), { headers: cors() });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Spec generation failed', detail: String(e) }), { status: 500, headers: cors() });
      }
    }

    // ── API: Evidence audit via three.ws ─────────────────────────
    if (path === '/api/evidence/audit' && request.method === 'POST') {
      try {
        const body = await request.json();
        const claim = body.claim || body.claim_text || '';
        const r = await fetch(THREEWS_URL, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + threewsKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ claim, strictness: body.strictness || 'medium' }),
        });
        if (r.status === 402) return new Response(JSON.stringify({ verdict: 'insufficient', confidence: 0, sources: [], attestation: '', error: 'Paid tier required' }), { headers: cors() });
        if (!r.ok) { const t = await r.text(); throw new Error('three.ws ' + r.status + ': ' + t.substring(0, 200)); }
        return new Response(JSON.stringify(await r.json()), { headers: cors() });
      } catch (e) {
        return new Response(JSON.stringify({ verdict: 'insufficient', confidence: 0, sources: [], attestation: '', error: String(e) }), { headers: cors() });
      }
    }

    // ── API: Dispute adjudication ────────────────────────────────
    if (path === '/api/dispute/adjudicate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const sys = 'You are the Vouch AI Adjudicator. Review the commitment spec, evidence, auditor verdict, and challenge argument. Return JSON with keys: ruling (creator_wins, challenger_wins, insufficient_evidence), confidence (0-1), reasoning.';
        const user = JSON.stringify({ commitment: body.commitment || {}, evidence: body.evidence || {}, auditor_verdict: body.auditor_verdict || {}, challenge: body.dispute_reason || '' });
        const raw = await callVenice(veniceKey, 'qwen-2.5-72b', sys, user);
        const result = extractJson(raw);
        return new Response(JSON.stringify(result), { headers: cors() });
      } catch (e) {
        return new Response(JSON.stringify({ ruling: 'insufficient_evidence', confidence: 0, reasoning: String(e) }), { headers: cors() });
      }
    }

    // ── Static: index.html — serve as-is, inject runtime env vars ──
    if (path === '/' || path === '/index.html') {
      const cdnResp = await fetch(CDN_BASE + '/index.html');
      let html = await cdnResp.text();
      const paraKey = env.PARA_API_KEY || '';
      html = html.replace('</head>', '<script>window.__PARA_API_KEY__="' + paraKey + '";</script></head>');
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    }

    // ── Static: proxy other assets from CDN ──────────────────────
    const cdnResp = await fetch(CDN_BASE + path);
    if (cdnResp.ok) {
      const nh = new Headers(cdnResp.headers);
      nh.set('Access-Control-Allow-Origin', '*');
      return new Response(cdnResp.body, { status: cdnResp.status, headers: nh });
    }

    return new Response('Not Found', { status: 404 });
  },
};
