// Vouch Combined Worker — serves React app + handles API (Venice AI + three.ws)
const VENICE_URL = 'https://api.venice.ai/api/v1/chat/completions';
const THREEWS_URL = 'https://three.ws/api/x402/fact-check';
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/ToXMon/vouch@main/frontend/dist';

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

    // Static: index.html with CDN-rewritten asset paths
    if (path === '/' || path === '/index.html') {
      const cdnResp = await fetch(CDN_BASE + '/index.html');
      let html = await cdnResp.text();
      html = html.split('src="/assets/').join('src="' + CDN_BASE + '/assets/');
      html = html.split('href="/assets/').join('href="' + CDN_BASE + '/assets/');
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
