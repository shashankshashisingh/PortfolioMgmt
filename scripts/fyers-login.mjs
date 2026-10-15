// Fyers login: exchanges a Fyers auth code for tokens and stores them for the fyers-quotes Edge Function.
//
// Two ways to run it:
//
// A) GitHub Actions (no local machine): the "Fyers login" workflow runs this with FYERS_AUTH_CODE and the
//    Supabase service-role key set as repository secrets/inputs. Tokens are written straight to Supabase and
//    are never printed, so they do not appear in the (possibly public) workflow log.
//
// B) Your own computer:
//      FYERS_APP_ID=ABCD1234-100 FYERS_SECRET_ID=... node scripts/fyers-login.mjs
//    It prints a login URL, you paste back the redirected URL, and it prints one SQL statement for the
//    Supabase SQL Editor (nothing is written to disk).
//
// Needed in both: FYERS_APP_ID, FYERS_SECRET_ID. Optional: FYERS_REDIRECT_URI (must match the Fyers app),
// FYERS_AUTH_CODE (skips the prompt), SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (store directly).

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const appId = process.env.FYERS_APP_ID;
const secret = process.env.FYERS_SECRET_ID;
const redirect = process.env.FYERS_REDIRECT_URI || 'https://trade.fyers.in/api-login/redirect-uri/index.html';
if (!appId || !secret) {
  console.error('Set FYERS_APP_ID and FYERS_SECRET_ID (and FYERS_REDIRECT_URI if your app uses a custom one).');
  process.exit(1);
}

// In CI, check this before spending the single-use auth code, and never fall back to printing tokens into a log (it may be public).
if (process.env.GITHUB_ACTIONS === 'true' && !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as repository secrets. Nothing was sent, printed or stored.');
  process.exit(1);
}

const FYERS = 'https://api-t1.fyers.in';
const hash = createHash('sha256').update(`${appId}:${secret}`).digest('hex');
const loginUrl =
  `${FYERS}/api/v3/generate-authcode?client_id=${encodeURIComponent(appId)}` +
  `&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&state=portfoliomgmt`;

let pasted = (process.env.FYERS_AUTH_CODE || '').trim();
if (!pasted) {
  console.log('\n1) Open this URL, log in to Fyers and approve the app:\n\n' + loginUrl + '\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  pasted = (await rl.question('2) Paste the full URL you were redirected to (or just the auth_code): ')).trim();
  rl.close();
}

let code = pasted;
try {
  code = new URL(pasted).searchParams.get('auth_code') || pasted;
} catch {
  /* not a URL: assume the bare code was given */
}
if (!code) {
  console.error('No auth_code found.');
  process.exit(1);
}

const res = await fetch(`${FYERS}/api/v3/validate-authcode`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'authorization_code', appIdHash: hash, code }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.access_token) {
  // Auth codes are single use and expire quickly: a fresh login is usually the fix.
  console.error('Fyers rejected the login:', body.message || res.status, '- get a fresh auth_code and retry.');
  process.exit(1);
}

const nextSixAmIst = () => {
  const ist = new Date(Date.now() + 19800000);
  let t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 6, 0, 0);
  if (t <= ist.getTime()) t += 86400000;
  return new Date(t - 19800000).toISOString();
};
const row = {
  id: 1,
  access_token: body.access_token,
  access_expires_at: nextSixAmIst(),
  refresh_token: body.refresh_token ?? null,
  refresh_expires_at: new Date(Date.now() + 14 * 86400000).toISOString(), // Fyers refresh tokens last about 15 days
  updated_at: new Date().toISOString(),
};

const supaUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supaUrl && serviceKey) {
  const up = await fetch(`${supaUrl}/rest/v1/fyers_auth?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      // New-style sb_secret_ keys are not JWTs and go in the apikey header only; legacy service_role keys are JWTs.
      ...(serviceKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${serviceKey}` }),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!up.ok) {
    console.error('Fyers login worked but Supabase refused the write:', up.status, (await up.text()).slice(0, 300));
    console.error('Check that the fyers_auth table exists (supabase/schema.sql) and SUPABASE_SERVICE_ROLE_KEY is the service_role key.');
    process.exit(1);
  }
  console.log('Fyers login stored in Supabase.' + (row.refresh_token ? '' : ' Note: no refresh token was returned, so it lapses tomorrow morning.'));
} else {
  const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
  console.log('\n3) Run this in the Supabase SQL Editor:\n');
  console.log(
    `insert into public.fyers_auth (id, access_token, access_expires_at, refresh_token, refresh_expires_at, updated_at)\n` +
      `values (1, ${q(row.access_token)}, ${q(row.access_expires_at)}, ${q(row.refresh_token)}, ${q(row.refresh_expires_at)}, now())\n` +
      `on conflict (id) do update set access_token = excluded.access_token, access_expires_at = excluded.access_expires_at,\n` +
      `  refresh_token = excluded.refresh_token, refresh_expires_at = excluded.refresh_expires_at, updated_at = now();\n`,
  );
  if (!row.refresh_token) console.warn('Note: Fyers returned no refresh token, so the access token will lapse tomorrow morning.');
}
