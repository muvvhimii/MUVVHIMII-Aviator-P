# MUVVHIMII — Aviator AI starter

This starter separates the browser from Neon. The browser calls `/api/*`; the server uses `DATABASE_URL` to access Neon.

## Run locally

1. Install Node.js 20+.
2. Run `npm install`.
3. Set `DATABASE_URL` to the Neon Production connection string as an environment variable.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Important

Do not paste the Neon connection string into `public/index.html` or commit it to source control.

The prediction engine is intentionally not presented as a guaranteed predictor. A live Aviator round feed is still required before the dashboard can truthfully display live round data.
