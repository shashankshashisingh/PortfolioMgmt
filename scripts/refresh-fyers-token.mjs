// Scheduled Fyers token renewal for PortfolioMgmt.
// Reads the private token row from Supabase, refreshes the Fyers access token,
// and writes the replacement token back without logging any credentials or tokens.

import { createHash } from 'node:crypto';

const appId = process.env.FYERS_APP_ID;
const secret = process.env.FYERS_SECRET_ID;
const pin = process.env.FYERS_PIN;
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!appId || !secret || !pin || !supabaseUrl || !serviceKey) {
  console.error('Missing required secrets: FYERS_APP_ID, FYERS_SECRET_ID, FYERS_PIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabaseHeaders = {
  apikey: serviceKey,
  ...(serviceKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${serviceKey}` }),
  'Content-Type': 'application/json',
};

async function supabase(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: { ...supabaseHeaders, ...(options.headers || {}) },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

function nextSixAmIst() {
  const ist = new Date(Date.now() + 19800000);
  let t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 6, 0, 0);
  if (t <= ist.getTime()) t += 86400000;
  return new Date(t - 19800000).toISOString();
}

const rows = await supabase('fyers_auth?select=id,refresh_token,refresh_expires_at&id=eq.1');
const row = rows?.[0];
if (!row?.refresh_token) {
  console.error('No Fyers refresh token is stored. Run the Fyers login workflow once to authorize the app.');
  process.exit(1);
}
if (row.refresh_expires_at && Date.parse(row.refresh_expires_at) <= Date.now()) {
  console.error('The Fyers refresh token has expired. Fyers requires a fresh authorization; run the Fyers login workflow.');
  process.exit(1);
}

const appIdHash = createHash('sha256').update(`${appId}:${secret}`).digest('hex');
const response = await fetch('https://api-t1.fyers.in/api/v3/validate-refresh-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'refresh_token',
    appIdHash,
    refresh_token: row.refresh_token,
    pin,
  }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok || body.s === 'error' || !body.access_token) {
  console.error('Fyers token renewal failed:', body.message || response.status, '. A fresh Fyers login may be required.');
  process.exit(1);
}

const update = {
  access_token: body.access_token,
  access_expires_at: nextSixAmIst(),
  updated_at: new Date().toISOString(),
};
// Some Fyers responses rotate the refresh token. Persist it and extend its local
// expiry window only when Fyers actually returns a replacement refresh token.
if (body.refresh_token && body.refresh_token !== row.refresh_token) {
  update.refresh_token = body.refresh_token;
  update.refresh_expires_at = new Date(Date.now() + 14 * 86400000).toISOString();
}
await supabase('fyers_auth?id=eq.1', {
  method: 'PATCH',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify(update),
});
console.log('Fyers access token renewed and saved securely to Supabase.');
