import assert from "node:assert/strict";
import { parseAmfiNav } from "../scripts/fetch-mf-nav.mjs";

const sample = [
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
  "100123;INF090I01AA1;;Example Equity Fund - Direct Plan - Growth;123.4567;03-Nov-2026",
  "100124;;INF090I01AA2;Example Debt Fund - Regular Plan - Growth;10.2500;03-Nov-2026",
  "header;not;a;scheme;row;today",
  "100125;ISIN;;;0;03-Nov-2026",
].join("\n");
const schemes = parseAmfiNav(sample);
assert.equal(Object.keys(schemes).length, 2);
assert.deepEqual(schemes["100123"], {
  name: "Example Equity Fund - Direct Plan - Growth",
  nav: 123.4567,
  date: "2026-11-03",
  isin: "INF090I01AA1",
});
assert.equal(schemes["100124"].isin, "INF090I01AA2");
assert.equal(schemes["100125"], undefined);
console.log("AMFI NAV tests passed");
