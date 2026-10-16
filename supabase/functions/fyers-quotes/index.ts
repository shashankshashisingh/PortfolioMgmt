// Supabase Edge Function: live NSE quotes from Fyers for signed-in users.
//
// Secrets (set with `supabase secrets set`, never commit them):
//   FYERS_APP_ID      e.g. ABCD1234-100
//   FYERS_SECRET_ID   the app secret
//   FYERS_PIN         the Fyers account PIN, used only to renew the access token
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to Edge Functions automatically.
//
// The caller must send a valid Supabase user JWT (verify_jwt stays on), so anonymous visitors cannot spend
// the Fyers rate limit. Tokens live in public.fyers_auth, which has no RLS policies: only the service role reads it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import {
  FYERS_QUOTE_CHUNK,
  INDEX_MAP,
  MAX_SYMBOLS_PER_REQUEST,
  appIdHash,
  chunk,
  cleanKey,
  nextSixAmIst,
  parseQuotes,
  toFyersSymbol,
  tokenUsable,
} from './lib.js';

const FYERS = 'https://api-t1.fyers.in';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// Best-effort cache shared by requests that land on the same isolate; keeps many users from multiplying Fyers calls.
const CACHE_MS = 5000;
const cache = new Map<string, { at: number; q: Record<string, unknown> }>();

class ReauthRequired extends Error {}

async function getAccessToken(forceRefresh = false): Promise<string> {
  const { data: row, error } = await admin.from('fyers_auth').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error('token table unreadable: ' + error.message);
  if (!row) throw new ReauthRequired('no Fyers token stored yet');
  if (!forceRefresh && row.access_token && tokenUsable(row.access_expires_at)) return row.access_token;

  const appId = Deno.env.get('FYERS_APP_ID');
  const secret = Deno.env.get('FYERS_SECRET_ID');
  const pin = Deno.env.get('FYERS_PIN');
  if (!appId || !secret || !pin) throw new Error('FYERS_APP_ID, FYERS_SECRET_ID and FYERS_PIN must be set as secrets');
  if (!row.refresh_token || (row.refresh_expires_at && Date.parse(row.refresh_expires_at) < Date.now())) {
    throw new ReauthRequired('refresh token expired');
  }

  const res = await fetch(`${FYERS}/api/v3/validate-refresh-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      appIdHash: await appIdHash(appId, secret),
      refresh_token: row.refresh_token,
      pin,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.s === 'error' || !body.access_token) {
    throw new ReauthRequired('Fyers refused the refresh: ' + (body.message || res.status));
  }
  const update: Record<string, unknown> = {
    access_token: body.access_token,
    access_expires_at: nextSixAmIst(),
    updated_at: new Date().toISOString(),
  };
  if (body.refresh_token) {
    update.refresh_token = body.refresh_token;
    update.refresh_expires_at = new Date(Date.now() + 14 * 86400000).toISOString();
  }
  const { error: upErr } = await admin.from('fyers_auth').update(update).eq('id', 1);
  if (upErr) console.error('could not store refreshed token', upErr.message);
  return body.access_token;
}

async function fetchQuotes(fyersSymbols: string[], token: string, appId: string) {
  const res = await fetch(`${FYERS}/data/quotes?symbols=${encodeURIComponent(fyersSymbols.join(','))}`, {
    headers: { Authorization: `${appId}:${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405);

  let input: { symbols?: unknown; indices?: unknown };
  try {
    input = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const equityKeys = (Array.isArray(input.symbols) ? input.symbols : []).map(cleanKey).filter((k) => k && !INDEX_MAP[k]);
  const indexInput = (Array.isArray(input.indices) ? input.indices : []).map(cleanKey).filter(Boolean);
  // Only benchmarks we know a Fyers index symbol for are queried; anything else is reported back, not guessed as an equity.
  const unknownIndices = indexInput.filter((k) => !INDEX_MAP[k]);
  const keys = [...new Set([...equityKeys, ...indexInput.filter((k) => INDEX_MAP[k])])];
  if (!keys.length) return json({ quotes: {}, unresolved: unknownIndices, asOf: new Date().toISOString() });
  if (keys.length > MAX_SYMBOLS_PER_REQUEST) return json({ error: `at most ${MAX_SYMBOLS_PER_REQUEST} symbols per request` }, 400);

  const appId = Deno.env.get('FYERS_APP_ID') || '';
  const out: Record<string, unknown> = {};
  const now = Date.now();
  const need: string[] = [];
  for (const k of keys) {
    const hit = cache.get(k);
    if (hit && now - hit.at < CACHE_MS) out[k] = hit.q;
    else need.push(k);
  }

  const unresolved: string[] = [...unknownIndices];
  if (need.length) {
    try {
      let token = await getAccessToken();
      const run = async (list: string[], series: string) => {
        // fyersSymbol -> dashboard key, for this series
        const byFyers = new Map(list.map((k) => [toFyersSymbol(k, series), k]));
        const failedKeys: string[] = [];
        for (const part of chunk([...byFyers.keys()], FYERS_QUOTE_CHUNK)) {
          let r = await fetchQuotes(part, token, appId);
          if (r.status === 401 || r.body?.code === -16 || r.body?.code === -15) {
            token = await getAccessToken(true); // token lapsed early: renew once and retry
            r = await fetchQuotes(part, token, appId);
          }
          if (r.body?.s === 'error' && !r.body?.d) {
            if (r.status === 429) throw new Error('Fyers rate limit reached');
            throw new Error('Fyers: ' + (r.body.message || r.status));
          }
          const { quotes, failed } = parseQuotes(r.body);
          for (const [fs, q] of Object.entries(quotes)) {
            const key = byFyers.get(fs);
            if (!key) continue;
            out[key] = q;
            cache.set(key, { at: Date.now(), q: q as Record<string, unknown> });
          }
          for (const fs of failed) {
            const key = byFyers.get(fs);
            if (key) failedKeys.push(key);
          }
          // symbols Fyers did not echo back at all count as failed too
          for (const fs of part) {
            const key = byFyers.get(fs)!;
            if (!out[key] && !failedKeys.includes(key)) failedKeys.push(key);
          }
        }
        return failedKeys;
      };

      const firstMiss = await run(need, 'EQ');
      // Retry misses in the BE (trade-for-trade) series; indices have no series so they simply stay unresolved.
      const retry = firstMiss.filter((k) => toFyersSymbol(k, 'EQ') !== toFyersSymbol(k, 'BE'));
      const stillMissing = retry.length ? await run(retry, 'BE') : [];
      unresolved.push(...firstMiss.filter((k) => !retry.includes(k)), ...stillMissing);
    } catch (e) {
      if (e instanceof ReauthRequired) return json({ error: 'fyers_reauth_required', message: e.message }, 503);
      console.error(e);
      return json({ error: 'fyers_unavailable', message: e instanceof Error ? e.message : String(e) }, 502);
    }
  }

  return json({ quotes: out, unresolved, asOf: new Date().toISOString() });
});
