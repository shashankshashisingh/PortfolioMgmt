import assert from "node:assert/strict";
import { getJson, parseMfapiLatest, mergeSchemeCatalog } from "../scripts/fetch-mf-nav.mjs";

// A temporary 429 response should be retried, honoring Retry-After.
let attempts = 0;
const delays = [];
const payload = [{ schemeCode: 123, schemeName: "Example Fund" }];
const result = await getJson("https://api.mfapi.in/mf?limit=1000&offset=0", {
  fetchImpl: async () => {
    attempts++;
    if (attempts === 1) return new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  },
  sleepFn: async ms => delays.push(ms),
});
assert.deepEqual(result, payload);
assert.equal(attempts, 2);
assert.deepEqual(delays, [0]);

// Permanent client errors should fail immediately rather than being retried.
let badRequestAttempts = 0;
await assert.rejects(
  getJson("https://api.mfapi.in/mf", {
    fetchImpl: async () => {
      badRequestAttempts++;
      return new Response("bad request", { status: 400 });
    },
    sleepFn: async () => {},
  }),
  /MFapi request failed \(400\)/,
);
assert.equal(badRequestAttempts, 1);

const latestPayload = [
  {
    meta: {
      scheme_code: 125497,
      scheme_name: "HDFC Top 100 Fund - Direct Plan - Growth",
      isin_growth: "INF179K01BB2",
      fund_house: "HDFC Mutual Fund",
      scheme_category: "Equity Scheme - Large Cap Fund",
    },
    data: [{ date: "03-11-2026", nav: "892.45600" }],
    status: "SUCCESS",
  },
  {
    meta: { schemeCode: 119551, schemeName: "SBI Liquid Fund - Direct Plan - Growth" },
    data: [{ date: "02-11-2026", nav: "10.25000" }],
  },
  { meta: { scheme_code: 9, scheme_name: "Invalid NAV" }, data: [{ date: "03-11-2026", nav: "0" }] },
];
const latest = parseMfapiLatest(latestPayload);
assert.equal(Object.keys(latest).length, 2);
assert.deepEqual(latest["125497"], {
  name: "HDFC Top 100 Fund - Direct Plan - Growth",
  nav: 892.456,
  date: "2026-11-03",
  isin: "INF179K01BB2",
  fundHouse: "HDFC Mutual Fund",
  category: "Equity Scheme - Large Cap Fund",
});
const merged = mergeSchemeCatalog([
  { schemeCode: 125497, schemeName: "HDFC Top 100 Fund - Direct Plan - Growth", isinGrowth: "INF179K01BB2" },
  { schemeCode: 555, schemeName: "A scheme whose NAV is temporarily unavailable" },
], latest);
assert.equal(merged["125497"].nav, 892.456);
assert.equal(merged["555"].nav, null);
assert.equal(merged["555"].name, "A scheme whose NAV is temporarily unavailable");
console.log("MFapi NAV tests passed");
