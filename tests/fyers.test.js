// Run: node tests/fyers.test.js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  INDEX_MAP, appIdHash, chunk, cleanKey, nextSixAmIst, parseQuotes, toFyersSymbol, tokenUsable,
} from '../supabase/functions/fyers-quotes/lib.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('equity symbols map to the EQ series by default and BE on retry', () => {
  assert.equal(toFyersSymbol('reliance'), 'NSE:RELIANCE-EQ');
  assert.equal(toFyersSymbol('M&M'), 'NSE:M&M-EQ');
  assert.equal(toFyersSymbol('SOMETHING', 'BE'), 'NSE:SOMETHING-BE');
});

t('benchmark keys map to Fyers index symbols and ignore the series', () => {
  assert.equal(toFyersSymbol('NIFTY50'), 'NSE:NIFTY50-INDEX');
  assert.equal(toFyersSymbol('NIFTY50', 'BE'), 'NSE:NIFTY50-INDEX');
  for (const k of Object.keys(INDEX_MAP)) assert.match(INDEX_MAP[k], /^NSE:[A-Z0-9]+-INDEX$/);
});

t('unsafe or empty keys are rejected', () => {
  assert.equal(cleanKey('RELIANCE;DROP'), '');
  assert.equal(cleanKey('  tcs '), 'TCS');
  assert.equal(cleanKey(''), '');
  assert.equal(toFyersSymbol('a,b'), '');
});

t('chunk splits into groups of at most n', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 50), []);
});

t('parseQuotes keeps good rows and reports failures', () => {
  const { quotes, failed } = parseQuotes({
    s: 'ok',
    d: [
      { n: 'NSE:TCS-EQ', s: 'ok', v: { lp: 4012.5, prev_close_price: 4000, chp: 0.31, tt: 1760500000 } },
      { n: 'NSE:BAD-EQ', s: 'error', v: {} },
      { n: 'NSE:ZERO-EQ', s: 'ok', v: { lp: 0 } },
    ],
  });
  assert.deepEqual(quotes['NSE:TCS-EQ'], { ltp: 4012.5, prevClose: 4000, changePct: 0.31, ts: 1760500000 });
  assert.deepEqual(failed.sort(), ['NSE:BAD-EQ', 'NSE:ZERO-EQ']);
  assert.deepEqual(parseQuotes(null), { quotes: {}, failed: [] });
});

{
  const expected = createHash('sha256').update('ABCD1234-100:s3cret').digest('hex');
  assert.equal(await appIdHash('ABCD1234-100', 's3cret'), expected);
  n++;
  console.log('ok - appIdHash is sha256 of "appId:secret"');
}

t('tokenUsable respects expiry and a 5 minute skew', () => {
  const now = Date.parse('2026-10-15T05:00:00Z');
  assert.equal(tokenUsable('2026-10-15T20:00:00Z', now), true);
  assert.equal(tokenUsable('2026-10-15T05:03:00Z', now), false);
  assert.equal(tokenUsable('', now), false);
  assert.equal(tokenUsable(null, now), false);
});

t('nextSixAmIst gives the next 06:00 IST (00:30 UTC)', () => {
  // 10:00 IST on 15 Oct -> next is 16 Oct 06:00 IST = 15 Oct 00:30 UTC + 1 day
  assert.equal(nextSixAmIst(Date.parse('2026-10-15T04:30:00Z')), '2026-10-16T00:30:00.000Z');
  // 03:00 IST on 15 Oct (14 Oct 21:30 UTC) -> same day 06:00 IST = 15 Oct 00:30 UTC
  assert.equal(nextSixAmIst(Date.parse('2026-10-14T21:30:00Z')), '2026-10-15T00:30:00.000Z');
});

console.log(`\n${n} Fyers tests passed`);
