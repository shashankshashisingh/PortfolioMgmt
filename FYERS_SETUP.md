# Fyers setup — simplified

This project uses Fyers as the current-price source. NSE Bhavcopy remains for historical prices, symbol lookup and archives only.

## One-time setup

### 1. Add GitHub repository secrets

Open **Settings → Secrets and variables → Actions → New repository secret** in this repository and add:

- `SUPABASE_ACCESS_TOKEN` — create at https://supabase.com/dashboard/account/tokens
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase Project Settings → API Keys. Use the service-role/secret key, never the publishable key.
- `FYERS_APP_ID` — from your Fyers API app
- `FYERS_SECRET_ID` — from your Fyers API app
- `FYERS_PIN` — your Fyers trading PIN, used only by the server-side token renewal

Do not paste these credentials into this repository's code, issues, or chat.

### 2. Create the secure token table once

In the Supabase dashboard for this project, open **SQL Editor** and run the `fyers_auth` table section from `supabase/schema.sql`. It stores tokens server-side and denies browser access.

### 3. Run the setup workflow

Open **Actions → Configure and deploy Fyers → Run workflow**:
https://github.com/shashankshashisingh/PortfolioMgmt/actions/workflows/deploy-fyers-function.yml

This workflow validates the GitHub secrets, copies the three Fyers credentials into Supabase Edge Function secrets, and deploys the quote function. You no longer need to enter those same credentials separately in Supabase.

### 4. Authorize Fyers once

Open **Actions → Fyers login → Run workflow**:
https://github.com/shashankshashisingh/PortfolioMgmt/actions/workflows/fyers-login.yml

To get the one-time authorization code:
1. Open this URL in your browser, replacing `YOUR_APP_ID` with the Fyers App ID:
   `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=YOUR_APP_ID&redirect_uri=https%3A%2F%2Ftrade.fyers.in%2Fapi-login%2Fredirect-uri%2Findex.html&response_type=code&state=portfoliomgmt`
2. Sign in to Fyers and approve the app.
3. Copy the full redirect URL from your browser's address bar.
4. Paste it into the workflow's `auth_code` input and run the workflow. The workflow stores the tokens in Supabase and does not print them.

Auth codes are single-use and expire quickly. If the workflow says the code is invalid, repeat the authorization step to get a fresh one.

### 5. Verify prices

Sign in to Portfolio Desk, open **Data**, and click **Check again**. Fyers should show as available once there is at least one supported NSE holding or benchmark to quote.

## Automatic renewal

The **Refresh Fyers token** workflow attempts renewal daily at 06:05 IST:
https://github.com/shashankshashisingh/PortfolioMgmt/actions/workflows/refresh-fyers-token.yml

The quote function also attempts to renew an expired access token when called. If Fyers accepts the refresh-token flow, you should not need to authorize every day. Fyers can still require a new authorization if a refresh token expires or its API rejects renewal. If the refresh workflow fails, inspect its run log and repeat step 4 only if it reports that fresh authorization is required.

## Troubleshooting

- **“FYERS_APP_ID, FYERS_SECRET_ID and FYERS_PIN must be set as secrets”** — run **Configure and deploy Fyers**. Check that all six GitHub repository secrets in step 1 are present.
- **“No Fyers token stored”** — complete step 4.
- **Refresh token expired / Fyers refused refresh** — repeat step 4 to authorize again.
- **Function deployment fails** — verify `SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct.
- **Some symbols have no quote** — only symbols supported by Fyers and mapped to NSE EQ/BE or the configured index symbols can return a quote. Bhavcopy remains the historical source; it is not substituted as the current quote.
