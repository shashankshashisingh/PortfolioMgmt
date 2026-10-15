# Fyers live prices setup

Current prices and last traded prices come from Fyers through a Supabase Edge Function (`supabase/functions/fyers-quotes`), even when NSE is closed. NSE Bhavcopy is saved daily by GitHub Actions for historical price series, the symbol directory and the downloadable archive only; its snapshot is not used to override current valuations.

Your Fyers app secret, PIN and tokens never reach the browser. The function only answers requests from signed-in users.

## How it behaves
- Polls every 15 seconds during NSE market hours and about every 5 minutes outside market hours, only for signed-in users. This lets the app fetch Fyers' last traded price after the market closes and when the site is first opened outside market hours.
- Quotes your open NSE positions and the benchmarks chosen for your funds. Mutual funds, FDs and other symbols without an NSE listing keep their existing prices.
- During market hours, a Fyers quote less than 90 seconds old is considered fresh. Outside market hours, the most recently fetched Fyers quote remains the current-price source until another Fyers quote replaces it. Bhavcopy is not used as a current-price fallback; if Fyers is unavailable, the app may show a last available historical close where no current quote exists.
- Equities are requested as `NSE:SYMBOL-EQ`, retried as `-BE`. Benchmarks use the index symbols in `INDEX_MAP` inside `supabase/functions/fyers-quotes/lib.js`. If a benchmark shows "No Fyers quote" on the Data tab, correct its entry there against Fyers' symbol master and redeploy.

## Setup without a terminal (browser and GitHub only)
Everything below can be done from the Supabase dashboard and the GitHub website.

1. **Create the token table.** Supabase dashboard, SQL Editor: paste the `fyers_auth` section at the bottom of `supabase/schema.sql` and run it.
2. **Add the Fyers secrets to Supabase.** Dashboard, Edge Functions, Secrets: add `FYERS_APP_ID`, `FYERS_SECRET_ID` and `FYERS_PIN`.
3. **Add repository secrets in GitHub** (Settings, Secrets and variables, Actions, New repository secret):
   - `SUPABASE_ACCESS_TOKEN`: create at <https://supabase.com/dashboard/account/tokens>
   - `FYERS_APP_ID` and `FYERS_SECRET_ID`: same values as step 2
   - `SUPABASE_URL`: your project URL, `https://uworsbrulgoylwvxxadh.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase dashboard, Project Settings, API Keys: either the `service_role` key (Legacy API keys tab) or a `sb_secret_...` secret key. Never the publishable key, and never put it in a file
   - If your Fyers app uses a custom redirect URL, add it as a repository *variable* named `FYERS_REDIRECT_URI`.
4. **Merge the pull request to `main`**, then open the Actions tab and run **Deploy Fyers quotes function** (it also runs automatically on later changes to the function).
5. **Log in to Fyers.** Open this URL in your browser, replacing `YOUR_APP_ID` (and the redirect if you use a custom one), and approve the app:
   ```
   https://api-t1.fyers.in/api/v3/generate-authcode?client_id=YOUR_APP_ID&redirect_uri=https%3A%2F%2Ftrade.fyers.in%2Fapi-login%2Fredirect-uri%2Findex.html&response_type=code&state=portfoliomgmt
   ```
   You land on the redirect page. Copy the whole address from the address bar (it contains `auth_code=...`), then immediately go to Actions, **Fyers login**, Run workflow, and paste it into the `auth_code` box. Auth codes are single use and expire fast, so if it fails, repeat this step.
6. Open the site, sign in, and check the Data tab for "Fyers live prices". Repeat step 5 about every 15 days.

## One-time setup with a terminal
1. **Create a Fyers API app** at <https://myapi.fyers.in/dashboard>. Note the App ID (like `ABCD1234-100`) and Secret ID, and set a redirect URL (the default `https://trade.fyers.in/api-login/redirect-uri/index.html` works).
2. **Create the token table.** Run the `fyers_auth` section of `supabase/schema.sql` in the Supabase SQL Editor. It has row-level security on and no policies, so only the Edge Function (service role) can read it.
3. **Set the secrets** (Supabase CLI, linked to your project):
   ```
   supabase secrets set FYERS_APP_ID=ABCD1234-100 FYERS_SECRET_ID=your-secret FYERS_PIN=your-fyers-pin
   ```
4. **Deploy the function** (keep JWT verification on, which is the default):
   ```
   supabase functions deploy fyers-quotes
   ```
5. **Log in once.** On your own computer:
   ```
   FYERS_APP_ID=ABCD1234-100 FYERS_SECRET_ID=your-secret npm run fyers:login
   ```
   Open the printed URL, log in, paste the URL you are redirected to, then run the SQL it prints in the Supabase SQL Editor.

## Keeping it running
The function renews the daily access token itself using the refresh token and your PIN. Fyers refresh tokens last about 15 days, so repeat step 5 roughly every two weeks. When it lapses (or before the first login), the Data tab says "Fyers login is missing or has expired". Current Fyers prices will resume after you refresh the Fyers login; Bhavcopy remains available for historical data.

## Notes
- Rotate the secrets if they are ever exposed: `supabase secrets set` again, then redo step 5.
- Do not put the App Secret, PIN or any token in `index.html`, `supabase-config.js` or the repository.
- Check Fyers' API terms before sharing the site beyond your own use: all signed-in users are served from one Fyers account.
