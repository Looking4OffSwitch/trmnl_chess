# Deploying TRMNL Chess on a VPS (Coolify + Docker)

## Overview
This setup runs a single container that serves both the API and static frontend. Coolify will build the image from the repo using the provided `Dockerfile` and run it with your environment variables.

## Prerequisites
- A Coolify-managed VPS with Docker available.
- Upstash (or any Redis) connection details.
- TRMNL webhook URL (optional) for fast device refresh.
- Domain/DNS pointing to your Coolify app.

## Required environment variables
Set these in Coolify (Environment tab) or in `website/backend/.env` for local compose runs:
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` **or** `UPSTASH_REDIS_URL`
- `FRONTEND_URL` → e.g. `https://chess.example.com`
- `TRMNL_WEBHOOK_URL` (optional but recommended)
- `SENTRY_DSN`, `LOG_LEVEL` (optional)

## Deployment steps (Coolify)
1. In Coolify, create a new application → Repository → select this repo/branch.
2. Build settings:
   - Build type: Dockerfile
   - Context: `.`
   - Dockerfile: `Dockerfile`
   - Port: `3000`
3. Environment:
   - Add the variables listed above; do **not** mount the `.env` file from git.
4. Resources:
   - Restart policy: unless-stopped (default is fine).
5. Deploy.
6. After deploy, verify:
   ```bash
   curl https://chess.example.com/api/trmnl-state   # expect {"status":"welcome"}
   ```

## Local test with Docker Compose
```bash
cp website/backend/.env.example website/backend/.env
# fill in env values (can point to your dev Redis)
docker compose up --build
# visit http://localhost:3000
```

## TRMNL plugin reminders
- `scripts/restore-prod-config.sh` now assumes your custom domain; set `PROD_DOMAIN=chess.example.com` before pushing.
- Polling URL: `https://<domain>/api/trmnl-state`
- Frontend/QR uses `FRONTEND_URL` (must match your domain for real devices).
