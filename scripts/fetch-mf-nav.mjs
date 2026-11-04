import fs from "node:fs";

const NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; PortfolioMgmt/1.0; +https://github.com/shashankshashisingh/PortfolioMgmt)",
  "Accept": "text/plain,*/*",
};

export function parseAmfiNav(text) {
  const schemes = {};
  for (const raw of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = line.split(";").map(x => x.trim());
    if (fields.length < 6 || !/^\d+$/.test(fields[0])) continue;
    const [code, isinGrowth, isinReinvestment, name, navText, dateText] = fields;
    const nav = Number(navText);
    const date = parseAmfiDate(dateText);
    if (!name || !Number.isFinite(nav) || nav <= 0 || !date) continue;
    schemes[code] = {
      name,
      nav,
      date,
      isin: isinGrowth || isinReinvestment || "",
    };
  }
  return schemes;
}

function parseAmfiDate(value) {
  const s = String(value || "").trim();
  let m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const months = { JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12" };
    const month = months[m[2].toUpperCase()];
    return month ? `${m[3]}-${month}-${m[1]}` : "";
  }
  m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

async function main() {
  const response = await fetch(NAV_URL, {
    headers: HEADERS,
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`AMFI NAV download failed: HTTP ${response.status}`);
  const text = await response.text();
  const schemes = parseAmfiNav(text);
  const codes = Object.keys(schemes);
  if (codes.length < 1000) {
    throw new Error(`AMFI response contained only ${codes.length} valid schemes; refusing to replace the existing NAV file.`);
  }
  const tradingDate = codes.reduce((latest, code) => schemes[code].date > latest ? schemes[code].date : latest, "");
  const output = {
    updated: new Date().toISOString(),
    tradingDate,
    source: "AMFI NAVAll.txt (daily NAV; not real-time)",
    sourceUrl: NAV_URL,
    count: codes.length,
    schemes,
  };
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/mf-nav.json", JSON.stringify(output) + "\n");
  console.log(`AMFI NAV: saved ${codes.length} schemes; latest NAV date ${tradingDate}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
