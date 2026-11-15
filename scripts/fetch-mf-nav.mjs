import fs from "node:fs";

const BASE = "https://api.mfapi.in";
const HEADERS = {
  "User-Agent": "PortfolioMgmt/1.0 (https://github.com/shashankshashisingh/PortfolioMgmt)",
  "Accept": "application/json",
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryAfterMs(response) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export async function getJson(url, {
  fetchImpl = fetch,
  sleepFn = sleep,
  maxAttempts = 6,
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(45000),
      });
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(`MFapi request failed after ${attempt} attempts: ${error.message}`);
      }
      const delay = Math.min(5000 * (2 ** (attempt - 1)), 60000);
      console.warn(`MFapi network error; retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/${maxAttempts}).`);
      await sleepFn(delay);
      continue;
    }

    if (response.ok) return response.json();

    const retryable = response.status === 429 || [500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`MFapi request failed (${response.status}) after ${attempt} attempt(s): ${url}`);
    }

    const delay = retryAfterMs(response) ?? Math.min(5000 * (2 ** (attempt - 1)), 60000);
    console.warn(`MFapi returned HTTP ${response.status}; retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/${maxAttempts}).`);
    await sleepFn(delay);
  }

  throw new Error(`MFapi request failed after ${maxAttempts} attempts: ${url}`);
}

function parseDate(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

export function parseMfapiLatest(payload) {
  const schemes = {};
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    const meta = row?.meta || row;
    const navRow = Array.isArray(row?.data) ? row.data[0] : row;
    const code = String(meta?.scheme_code ?? meta?.schemeCode ?? row?.schemeCode ?? row?.scheme_code ?? "");
    const name = String(meta?.scheme_name ?? meta?.schemeName ?? row?.schemeName ?? row?.scheme_name ?? "").trim();
    const nav = Number(navRow?.nav ?? row?.nav);
    const date = parseDate(navRow?.date ?? row?.date);
    if (!/^\d+$/.test(code) || !name || !Number.isFinite(nav) || nav <= 0 || !date) continue;
    schemes[code] = {
      name,
      nav,
      date,
      isin: meta?.isin_growth || meta?.isinGrowth || meta?.isin_div_reinvestment || meta?.isinDivReinvestment || "",
      fundHouse: meta?.fund_house || "",
      category: meta?.scheme_category || "",
    };
  }
  return schemes;
}

export function mergeSchemeCatalog(catalog, latest) {
  const schemes = {};
  for (const item of catalog || []) {
    const code = String(item?.schemeCode ?? item?.scheme_code ?? "");
    const name = String(item?.schemeName ?? item?.scheme_name ?? "").trim();
    if (!/^\d+$/.test(code) || !name) continue;
    const nav = latest[code];
    schemes[code] = {
      name: nav?.name || name,
      nav: nav?.nav ?? null,
      date: nav?.date || "",
      isin: item?.isinGrowth || item?.isin_growth || item?.isinDivReinvestment || item?.isin_div_reinvestment || nav?.isin || "",
      fundHouse: nav?.fundHouse || "",
      category: nav?.category || "",
    };
  }
  for (const [code, row] of Object.entries(latest)) if (!schemes[code]) schemes[code] = row;
  return schemes;
}

async function fetchCatalog() {
  const pageSize = 1000;
  const catalog = [];
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const page = await getJson(`${BASE}/mf?limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(page)) throw new Error("MFapi scheme catalog response was not an array.");
    catalog.push(...page);
    if (page.length < pageSize) break;
    // Avoid hitting MFapi's rate limit while paging through the full catalogue.
    await sleep(1500);
  }
  if (catalog.length < 1000) throw new Error(`MFapi returned only ${catalog.length} scheme records; refusing to replace the current NAV file.`);
  return catalog;
}

async function main() {
  const catalog = await fetchCatalog();
  const latestPayload = await getJson(`${BASE}/mf/latest`);
  const latest = parseMfapiLatest(latestPayload);
  if (Object.keys(latest).length < 1000) {
    throw new Error(`MFapi latest-NAV response contained only ${Object.keys(latest).length} valid schemes; refusing to replace the current NAV file.`);
  }
  const schemes = mergeSchemeCatalog(catalog, latest);
  const latestDates = Object.values(schemes).map(x => x.date).filter(Boolean).sort();
  const output = {
    updated: new Date().toISOString(),
    tradingDate: latestDates.at(-1) || "",
    source: "MFapi.in (daily mutual-fund NAV; not real-time)",
    sourceUrl: BASE,
    count: Object.keys(schemes).length,
    schemes,
  };
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/mf-nav.json", JSON.stringify(output) + "\n");
  console.log(`MFapi: saved ${output.count} schemes; ${Object.keys(latest).length} with NAV; latest NAV date ${output.tradingDate}.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
