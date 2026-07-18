// Vouch Combined Worker -- serves React app + handles API (Venice AI + three.ws)
const VENICE_URL = 'https://api.venice.ai/api/v1/chat/completions';
const THREEWS_URL = 'https://three.ws/api/x402/fact-check';
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/ToXMon/vouch@aa30fc2/frontend/dist';
const MONAD_RPC = 'https://testnet-rpc.monad.xyz';
const VOUCH_CONTRACT = '0x011189f535F744EC9A7a499F20df99f6CAdF1D25';

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const veniceKey = env.VENICE_API_KEY || '';
    const threewsKey = env.THREE_WS_API_KEY || '';

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

    // API: Health
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
        // IDs start at 0 — read up to nextId commitments
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
          //   slot0: hex[2:66]   creator (address — last 40 chars)
          //   slot1: hex[66:130] counterparty (address — last 40 chars)
          //   slot2: hex[130:194] specHash (bytes32)
          //   slot3: hex[194:258] vType (uint8 — last 2 chars)
          //   slot4: hex[258:322] stake (uint256)
          //   slot5: hex[322:386] deadline (uint256)
          //   slot6: hex[386:450] status (uint8 — last 2 chars)
          //   slot7: hex[450:514] evidenceHash (bytes32)
          const creator = '0x' + hex.slice(26, 66);
          const counterparty = '0x' + hex.slice(90, 130);
          const specHash = '0x' + hex.slice(130, 194);
          const vType = parseInt(hex.slice(256, 258), 16);
          const stakeHex = hex.slice(258, 322);
          const deadlineHex = hex.slice(322, 386);
          const status = parseInt(hex.slice(448, 450), 16);
          // Skip empty commitments (all zeros = uninitialized)
          if (creator === '0x' + '0'.repeat(40)) continue;
          commitments.push({
            id: i,
            creator,
            counterparty,
            specHash,
            vType,
            status,
            stake: BigInt('0x' + stakeHex).toString(),
            deadline: BigInt('0x' + deadlineHex).toString(),
          });
        }
        return new Response(JSON.stringify({ commitments }), { headers: cors() });
      } catch (e) {
        return new Response(JSON.stringify({ commitments: [], error: String(e) }), { status: 500, headers: cors() });
      }
    }

    if (path === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', venice_configured: !!veniceKey, threews_configured: !!threewsKey }), { headers: cors() });
    }

    // API: Generate commitment spec
    if (path === '/api/commitments/spec' && request.method === 'POST') {
      try {
        const body = await request.json();
        const sys = 'You are the Vouch AI Architect. Generate a commitment spec as JSON with keys: claim_text, verification_type (one of: photo, web, location, peer_sign, api), parties (array of addresses), deadline_iso, stake_amount_mon, spec_version. Return ONLY valid JSON, no markdown.';
        const user = JSON.stringify({ claim: body.claim_text, creator: body.creator_address, counterparty: body.counterparty_address });
        const raw = await callVenice(veniceKey, 'llama-3.3-70b', sys, user);
        const spec = extractJson(raw);
        const hash = await sha256Hex(JSON.stringify(spec));
        return new Response(JSON.stringify({ spec, spec_hash: hash }), { headers: cors() });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Spec generation failed', detail: String(e) }), { status: 500, headers: cors() });
      }
    }

    // API: Evidence audit via three.ws
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

    // API: Dispute adjudication
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

    // Static: index.html — serve as-is, assets proxied from same origin
    if (path === '/' || path === '/index.html') {
      const cdnResp = await fetch(CDN_BASE + '/index.html');
      let html = await cdnResp.text();
      // Inject runtime env vars from worker secrets
      const paraKey = env.PARA_API_KEY || '';
      html = html.replace('</head>', '<script>window.__PARA_API_KEY__="' + paraKey + '";</script></head>');
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    }

    // Static: proxy other assets from CDN
    const cdnResp = await fetch(CDN_BASE + path);
    if (cdnResp.ok) {
      const nh = new Headers(cdnResp.headers);
      nh.set('Access-Control-Allow-Origin', '*');
      return new Response(cdnResp.body, { status: cdnResp.status, headers: nh });
    }

    return new Response('Not Found', { status: 404 });
  },
};
