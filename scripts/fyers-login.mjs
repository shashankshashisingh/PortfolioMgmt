// One-time Fyers login. Run this on your own computer (about every 15 days when the refresh token lapses):
//
//   FYERS_APP_ID=ABCD1234-100 FYERS_SECRET_ID=... FYERS_REDIRECT_URI=https://trade.fyers.in/api-login/redirect-uri/index.html \
//     node scripts/fyers-login.mjs
//
// 1. It prints a Fyers login URL. Open it, log in, and approve the app.
// 2. Fyers redirects to your redirect URI with ?auth_code=... in the address bar. Paste that whole URL here.
// 3. It exchanges the code for tokens and prints one SQL statement. Run that in the Supabase SQL Editor.
//
// Nothing is written to disk and no Supabase key is needed. Treat the printed SQL like a password.

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const appId = process.env.FYERS_APP_ID;
const secret = process.env.FYERS_SECRET_ID;
const redirect = process.env.FYERS_REDIRECT_URI || 'https://trade.fyers.in/api-login/redirect-uri/index.html';
if (!appId || !secret) {
  console.error('Set FYERS_APP_ID and FYERS_SECRET_ID (and FYERS_REDIRECT_URI if your app uses a custom one).');
  process.exit(1);
}

const FYERS = 'https://api-t1.fyers.in';
const hash = createHash('sha256').update(`${appId}:${secret}`).digest('hex');
const loginUrl =
  `${FYERS}/api/v3/generate-authcode?client_id=${encodeURIComponent(appId)}` +
  `&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&state=portfoliomgmt`;

console.log('\n1) Open this URL, log in to Fyers and approve the app:\n\n' + loginUrl + '\n');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const pasted = (await rl.question('2) Paste the full URL you were redirected to (or just the auth_code): ')).trim();
rl.close();

let code = pasted;
try {
  code = new URL(pasted).searchParams.get('auth_code') || pasted;
} catch {
  /* not a URL: assume the bare code was pasted */
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
  console.error('Fyers rejected the login:', body.message || res.status);
  process.exit(1);
}

const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
const nextSixAmIst = () => {
  const ist = new Date(Date.now() + 19800000);
  let t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 6, 0, 0);
  if (t <= ist.getTime()) t += 86400000;
  return new Date(t - 19800000).toISOString();
};
const refreshExpires = new Date(Date.now() + 14 * 86400000).toISOString(); // Fyers refresh tokens last about 15 days

console.log('\n3) Run this in the Supabase SQL Editor:\n');
console.log(
  `insert into public.fyers_auth (id, access_token, access_expires_at, refresh_token, refresh_expires_at, updated_at)\n` +
    `values (1, ${q(body.access_token)}, ${q(nextSixAmIst())}, ${q(body.refresh_token)}, ${q(refreshExpires)}, now())\n` +
    `on conflict (id) do update set access_token = excluded.access_token, access_expires_at = excluded.access_expires_at,\n` +
    `  refresh_token = excluded.refresh_token, refresh_expires_at = excluded.refresh_expires_at, updated_at = now();\n`,
);
if (!body.refresh_token) console.warn('Note: Fyers returned no refresh token, so the access token will lapse tomorrow morning.');
