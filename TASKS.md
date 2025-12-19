# trmnl_chess Tasks

- [x] Display the Welcome/Landing page on the `trmnl` screen.
- [x] Set up the project structure (`backend` and `site` directories).
- [x] Implement the welcome screen on the `trmnl` plugin.
- [x] Create the player name entry form in the `site` directory.
- [x] Create the backend endpoint to handle game creation.
- [x] Implement QR code generation in the `trmnl` plugin.
- [x] Create a local development script to run all services.
- [x] Implement backend-to-trmnl communication for force refresh (local development solution).
- [x] Implement the chess board display in the `trmnl` plugin.
- [x] Implement move entry in the web app.
- [x] Implement the backend endpoint to handle moves.
- [x] Implement force refresh after a move is made.
- [x] Add win/loss/draw detection and display.
- [x] Refactor backend to use Redis for persistent state.
- [x] Enhance `README.md` with detailed local testing instructions.
- [x] Create `setup.sh` script for easy one-step installation.
- [x] Fix `polling_url` error in `trmnlp`.
- [x] Make QR code URL configurable for local testing.
- [x] Fix QR code generation for local preview.
- [x] Prepare for Vercel deployment.
- [x] Remove hardcoded IPs from Liquid templates (use backend_url variable).
- [x] Update settings.yml with production configuration.
- [x] Add environment variables to server.js (FRONTEND_URL, proper Redis connection).
- [x] Create comprehensive DEPLOYMENT.md guide.

## Production Enhancements (Optional)

- [x] **CRITICAL: Fix CURRENT_GAME.id for serverless** - Implemented dual approach: Redis-based current game tracking for production (serverless-compatible), filesystem-based for development. Functions `updateCurrentGameId()` and `getCurrentGameId()` now handle both environments automatically.

- [x] **Security: Restrict CORS** - Implemented environment-aware CORS restrictions. Production restricts to Vercel deployment URL and configured FRONTEND_URL. Development allows localhost variants and local network IPs.

- [x] **Input Validation** - Added comprehensive validation for player names (1-20 chars, alphanumeric + basic punctuation) and move inputs (chess notation format validation). Applied to game creation and move submission endpoints.

- [x] **Rate Limiting** - Implemented comprehensive rate limiting using @upstash/ratelimit with Redis backend. Rate limits:
  - Game creation: 10 games/hour per IP (production) / 1000/hour (development)
  - Moves: 60 moves/minute per IP (production) / 1000/minute (development)
  - Game actions (resign/undo): 20/minute per IP (production) / 1000/minute (development)
  - TRMNL polling: 100/minute per IP (production) / 10000/minute (development)
  - Returns HTTP 429 with retry-after headers when limits exceeded
  - Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables

- [ ] **Redis Connection Optimization** - Consider switching from ioredis to @upstash/redis for better serverless performance and automatic connection pooling.

- [ ] **Error Monitoring** - Add Sentry or similar for production error tracking.

## New Findings (2025-11-20)

- [x] **Production URLs accidentally set to local IPs** — `trmnl_chess/src/settings.yml`, `.trmnlp.yml`, and `website/site/config.js` restored to Vercel URLs; dev-generated files remain gitignored.
- [x] **Dev script leaves production settings mutated on non-SIGINT exits** — `dev.sh` now traps EXIT/INT/TERM and restores production settings once.
- [x] **Rate limiter hard-fails without Upstash REST env** — Added env check and in-memory fallback (still rate limits) when REST vars missing in dev; prod still requires them.
- [x] **Redis env not validated; unhandled promise rejections** — Startup now requires `UPSTASH_REDIS_URL`; Redis I/O wrapped in try/catch with 5xx responses and logging.
- [x] **Webhook lacks timeout/error handling** — Added timeout + structured logging for TRMNL webhook calls.
- [x] **Game IDs predictable and unauthenticated actions** — Game creation now uses `nanoid`; move/resign/undo require per-game token; tokens only returned on create or QR URL.
- [x] **Observability and diagnostics** — Added pino structured logging with request IDs.
- [x] **Documented token usage** — README/DEPLOYMENT now explain write tokens and sharing guidance; Vercel env lists updated.
- [ ] **Automated tests missing** — Create backend API tests (happy-path, invalid move, rate-limit disabled, Redis error handling) and minimal frontend smoke tests to catch regressions.

## Follow-ups
- [x] Document game token usage in README/DEPLOYMENT to guide users on sharing move URLs securely.
- [ ] Add Sentry DSN to Vercel when available and confirm error events arrive; tune sampling if noisy.
