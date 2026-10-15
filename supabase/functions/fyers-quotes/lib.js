// Pure helpers for the fyers-quotes Edge Function.
// Kept as plain JavaScript (no Deno or Node APIs beyond Web Crypto) so tests/fyers.test.js can import it.

// Dashboard benchmark keys -> Fyers index symbols.
// Verify any of these against Fyers' NSE_CM symbol master if a benchmark shows as unresolved.
export const INDEX_MAP = {
  NIFTY50: 'NSE:NIFTY50-INDEX',
  NIFTYBANK: 'NSE:NIFTYBANK-INDEX',
  NIFTY500: 'NSE:NIFTY500-INDEX',
  NIFTYNEXT50: 'NSE:NIFTYNXT50-INDEX',
  NIFTYMID150: 'NSE:NIFTYMIDCAP150-INDEX',
  NIFTYSMALL250: 'NSE:NIFTYSMALLCAP250-INDEX',
};

export const MAX_SYMBOLS_PER_REQUEST = 100; // what this proxy accepts from a client
export const FYERS_QUOTE_CHUNK = 50; // Fyers allows up to 50 symbols per quotes call

const SYMBOL_RE = /^[A-Z0-9&-]{1,30}$/;

export function cleanKey(v) {
  const k = String(v ?? '').trim().toUpperCase();
  return SYMBOL_RE.test(k) ? k : '';
}

// Dashboard key -> Fyers symbol. Equities default to the EQ series; BE is the retry series.
export function toFyersSymbol(key, series = 'EQ') {
  const k = cleanKey(key);
  if (!k) return '';
  if (INDEX_MAP[k]) return INDEX_MAP[k];
  return `NSE:${k}-${series}`;
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Turns a Fyers /data/quotes response into { fyersSymbol: {ltp, prevClose, changePct, ts} } plus a list of failures.
export function parseQuotes(resp) {
  const quotes = {};
  const failed = [];
  const rows = resp && Array.isArray(resp.d) ? resp.d : [];
  for (const row of rows) {
    const name = row && row.n;
    if (!name) continue;
    const v = row.v || {};
    const ltp = Number(v.lp);
    if (row.s === 'ok' && Number.isFinite(ltp) && ltp > 0) {
      const prev = Number(v.prev_close_price);
      quotes[name] = {
        ltp,
        prevClose: Number.isFinite(prev) && prev > 0 ? prev : null,
        changePct: Number.isFinite(Number(v.chp)) ? Number(v.chp) : null,
        ts: Number(v.tt) > 0 ? Number(v.tt) : null, // exchange tick time, epoch seconds
      };
    } else {
      failed.push(name);
    }
  }
  return { quotes, failed };
}

export async function appIdHash(appId, secret) {
  const data = new TextEncoder().encode(`${appId}:${secret}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fyers access tokens lapse around 06:00 IST the next day; treat anything within 5 minutes of expiry as stale.
export function tokenUsable(expiresAtIso, nowMs = Date.now(), skewMs = 300000) {
  const t = Date.parse(expiresAtIso || '');
  return Number.isFinite(t) && t - skewMs > nowMs;
}

// Next 06:00 IST strictly after nowMs, as ISO. Used when Fyers does not return an explicit expiry.
export function nextSixAmIst(nowMs = Date.now()) {
  const ist = new Date(nowMs + 19800000);
  let day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 6, 0, 0);
  if (day <= ist.getTime()) day += 86400000;
  return new Date(day - 19800000).toISOString();
}
