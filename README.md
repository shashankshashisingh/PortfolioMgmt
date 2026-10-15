# PortfolioMgmt

A single-page portfolio dashboard for Indian holdings across asset classes (equities, ETFs, mutual funds, gold, debt, fixed deposits).

## Features
- **Funds**: create funds such as Large Cap, Mid Cap and Small Cap, each with its own benchmark, and compare them side by side. Every other tab can be switched to one fund or all funds
- **Today**: portfolio value, day P&L, total profit, XIRR, allocation and movers
- **Holdings**: FIFO average cost, manual and CSV transaction entry, manual prices
- **Statistics**: volatility, Sharpe, Sortino, max drawdown, 1-day VaR, concentration, holding-period split
- **vs Benchmark**: beta, alpha, correlation, tracking error, information ratio, up/down capture, monthly returns
- **Rebalance**: target weights and trades needed
- Light, dark and system themes

## Asset classes
Equities, ETFs, Mutual Funds, Futures, Options, Commodities, REIT, InvIT, Money Market Funds, Long Term Fixed Income. Holdings are bundled under their class, with a subtotal row you can fold. Imports also accept common names (stock, etf, mf, gold, liquid, FD) and map them. Futures and options are valued as quantity times price. Stock transactions support Buy, Sell, Short sell and Cover short, with FIFO realized P&L. Short positions reserve margin equal to 115% of current short notional; the dashboard shows required margin and cash after margin. This is a portfolio simulation/ledger, not a broker margin engine, and does not place orders or enforce exchange-specific eligibility and settlement rules.

## Run
Open `index.html` on GitHub Pages or serve the repository over HTTP. Visitors can use the example portfolio without signing in. When signed in, portfolio data is saved to the Supabase cloud account; theme preference stays in browser storage. Opening it as a `file://` URL blocks the browser from loading the repository's data files.

## Accounts and cloud sync
Email/password signup, login, password reset, and per-user cloud portfolio persistence are available. Supabase's public browser key is configured in `supabase-config.js`; it is protected by row-level security and is not a secret. Never add a Supabase service-role key to the website. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for the dashboard checklist and [supabase/schema.sql](supabase/schema.sql) for the table/policies.

## Data sources

**NSE CM Bhavcopy is the daily end-of-day source for equity closes and symbol names. Live prices during market hours come from Fyers (signed-in users) and fall back to Bhavcopy; see [FYERS_SETUP.md](FYERS_SETUP.md).** The GitHub Action downloads the latest available official cash-market Bhavcopy and updates:
- `data/prices.json`: latest EQ/BE closing prices, previous close, percentage change and company name.
- `data/directory.json`: searchable symbol/company directory built from Bhavcopy symbols.
- `data/bhavcopy.json`: up to 30 cached daily Bhavcopies for MCP queries.
- `data/history.json`: daily closing-price series merged from Bhavcopy.

Bhavcopy is end-of-day data, **not an intraday real-time quote feed**. Intraday quotes come from the Fyers Edge Function (`supabase/functions/fyers-quotes`), which keeps your Fyers credentials server-side. Without Fyers, or when signed out, the dashboard uses the latest available Bhavcopy close where a quote is available; demo holdings or symbols without a quote can still display simulated fallback values. GitHub Actions may be delayed, and NSE may block requests from cloud runners.

The separate historical backfill workflow (`.github/workflows/update-history.yml`) supplements older history; it does not supply current dashboard prices or the symbol directory.

## GitHub Actions

| Workflow | Schedule | Purpose |
|---|---|---|
| Update NSE Bhavcopy | Weekdays at 18:00 IST (12:30 UTC), manually, or when its code/config changes | Primary price file, symbol directory, cached Bhavcopy and history merge |
| Update price history | Weekdays at 17:00 IST (11:30 UTC), manually, or when its code/config changes | Supplemental historical backfill |

The Bhavcopy fetcher tries the current NSE CM archive name and legacy ZIP format, and searches back across recent calendar days for weekends and holidays. The job runs parser/regression tests before writing data. If no usable Bhavcopy can be downloaded, it fails without replacing the existing data files.

To enable GitHub Pages, open repository Settings → Pages and publish the `main` branch (root). Inspect the Actions tab for scheduled run results and the Data tab for data status.

## NSE Bhavcopy MCP

A standalone local stdio MCP server is available in `mcp/server.js`. Install dependencies with `npm install`, then run `npm run bhavcopy`. MCP tools expose the latest cached Bhavcopy, date/symbol-filtered rows, symbol history and symbol search. See [mcp/README.md](mcp/README.md) for client configuration.

GitHub Actions refreshes the cache; it does not host a persistent MCP endpoint. To query through MCP, run the server locally against a checkout containing `data/bhavcopy.json` and `data/history.json`.

## Tests
- `npm test`
- `npm run test:bhavcopy`
- `npm run test:fyers`

## Roadmap
- Dividends and corporate actions
- Tax-lot reports


## Historical NSE Bhavcopy archive
The `Update NSE Bhavcopy` GitHub Actions workflow stores each available trading day's normalized NSE cash-market EQ/BE closing-price snapshot in `data/bhavcopy/YYYY-MM-DD.json` and maintains `data/bhavcopy-index.json`. The Data tab provides a date selector, table preview and JSON download. The compact `data/bhavcopy.json` file remains a latest-30-day cache. Archive rows include trading date, symbol, series, close, previous close and company name; this is a normalized closing-price archive, not the full raw NSE exchange CSV with every field.
