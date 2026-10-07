# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Najik is a 1-to-1 messaging and WebRTC calling app.

| Folder | Contents |
| --- | --- |
| `backend/` | Django 6 / DRF / Channels / Celery |
| `mobile/` | Expo SDK 57 / React Native / TypeScript / Expo Router / Zustand |
| `deploy/` | Production docker-compose |

`README.md` is the entry point. Each sub-folder has its own README.

## Ground rules

- **`docs/PROTOCOL.md` is the contract between backend and mobile.** Change it first, then update both sides.
  - Mobile mirrors it in `mobile/types/protocol.ts`.
  - The backend enforces it in `backend/apps/realtime/` (frame schemas) and in DRF serializers.
- **Never log** message bodies, tokens, passwords, SDP or push tokens, on either side. The backend uses structlog; the mobile app uses `services/telemetry`.
- **No hardcoded URLs or secrets.** Every new env var goes into `backend/.env.example` (and `deploy/.env.example` if it's needed in production), or into the mobile README's env section.
- **`mobile/ios` and `mobile/android` are generated (CNG) and gitignored.** Native changes go through config plugins or the local Expo module `mobile/modules/najik-calls`.

## Commands

```bash
# backend (uses backend/.venv)
cd backend && .venv/Scripts/python -m pytest -q
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
.venv/Scripts/python manage.py makemigrations --check --dry-run

# mobile
cd mobile && npm run typecheck && npm run lint && npm run format:check && npm test
npx expo export --platform android --platform ios       # proves the JS bundle builds
```

## Environment gotchas (this machine)

- **No Android SDK, no Mac, Java 8 only, and Docker usually not running.** Native Swift/Kotlin and the WebRTC libraries can't be compiled here. Treat them as unverified and say so.
- **Backend tests use SQLite + fakeredis + the in-memory channel layer.** Tests marked `postgres` only run in CI. A quick live server needs no config: `uvicorn config.asgi:application --lifespan off`.
- **The corporate network intercepts TLS.** If npm or expo-doctor fail on certificates, set `NODE_EXTRA_CA_CERTS` for that command. Don't change the global npm config.
