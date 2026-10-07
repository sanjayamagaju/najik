# Najik

A focused, production-grade 1-to-1 communication app with:
- real-time messaging with emoji, typing, presence, and sent/delivered/read status;
- 👋 Ping;
- WebRTC audio and video calls with YouTube-style quality controls;
- push notifications through FCM and APNs.

It has no groups, stories, channels or feeds, by design.

```
backend/   Django 6 + DRF + Channels (ASGI) + Celery · PostgreSQL · Redis
mobile/    Expo SDK 57 · React Native · TypeScript · Expo Router · Zustand
deploy/    Production docker-compose: Caddy (TLS) · api · worker · beat · Postgres · Redis · coturn
docs/      PROTOCOL.md (REST + WebSocket contract) · ARCHITECTURE.md (decisions)
.github/   CI (lint, tests on Postgres/Redis, image build, bundle) · EAS build/submit workflow
```

| Guide | What it covers |
| --- | --- |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | The API and WebSocket contract. Change it first, then both sides |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Key decisions: sync and seq, receipts, presence, call state, P2P vs SFU, adaptive quality |
| [backend/README.md](backend/README.md) | Backend dev setup, settings and env vars, tests, Celery |
| [mobile/README.md](mobile/README.md) | Dev builds, env config, EAS build/submit, signing, FCM/APNs, calls, CallKit, Play declarations |
| [deploy/README.md](deploy/README.md) | Server runbook: DNS, firewall, TLS, TURN, migrations, backups, releases/rollbacks, scaling |

## Quick start (local)

```bash
# Backend: works with zero config (SQLite, in-process fake Redis, log-only push)
cd backend
python -m venv .venv && . .venv/Scripts/activate        # .venv/bin/activate on macOS/Linux
pip install -r requirements/dev.txt
python manage.py migrate
uvicorn config.asgi:application --reload --lifespan off --host 0.0.0.0 --port 8000

# Optional, for production-like local infrastructure: Postgres, Redis, coturn
docker compose -f deploy/docker-compose.dev.yml up -d

# Mobile: needs a development build (Expo Go cannot load WebRTC or the native call module)
cd mobile
npm install
npx expo run:android          # or: eas build --profile development, then `npm start`
```

Point the dev app at your machine's LAN address with `EXPO_PUBLIC_API_URL=http://<lan-ip>:8000`. Details are in `mobile/README.md`. Calls between two physical devices on different networks need a TURN server; see `deploy/README.md` §4.

## Environments

- **Development, staging, production:** the backend picks its settings with `DJANGO_ENV`; the app uses `APP_ENV`, set per EAS build profile.
- **No hardcoded URLs or secrets:**
  - Backend values come from env vars, all documented in `backend/.env.example` and `deploy/.env.example`.
  - App values are set per environment with `eas env:create`.
- **Fail-closed checks:**
  - Production refuses to start without its required secrets.
  - Non-development app builds refuse plain `http://` or `ws://` URLs.

## Quality gates

| Area | Command | Status at handover |
| --- | --- | --- |
| Backend | `pytest`, `ruff check`, `ruff format --check`, `makemigrations --check`, `check --deploy` | 101 passed, 3 skipped (Postgres-only, these run in CI), clean |
| Mobile | `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npx expo export`, `npx expo-doctor` | 264 tests passed, clean, bundles build |

The end-to-end smoke test ran against a live server with two users. It covered:
- messaging, idempotent resend and read receipts;
- Ping;
- a full video call: invite, ringing, accept, offer/answer relay, quality request, hangup, call log.

## Not yet verified (needs hardware or credentials)

- **Native code has never been compiled.** The Swift/Kotlin call module (`mobile/modules/najik-calls`) and both WebRTC libraries under React Native 0.86's New Architecture still need a real build. This machine has no Android SDK or Mac.
- **Device behaviour:**
  - CallKit and the lock screen;
  - Android full-screen intents and foreground services on Android 14+;
  - Bluetooth routing;
  - encoder behaviour under `setParameters`;
  - real TURN relaying;
  - real FCM/APNs delivery.
- **Infrastructure:** real PostgreSQL and Redis run only in CI, and the Docker image build is CI-only. Docker wasn't running here.
- **Known limitation:** on Android, tapping *Decline* on the call notification while the app process is dead can't reach the server. The caller sees the 45 s timeout instead of "declined".

## Before the first store release

1. Create the Firebase project.
   - Upload `google-services.json` / `GoogleService-Info.plist` as EAS file env vars. Never commit them.
   - Put the FCM service account on the server.
2. Create an APNs auth key (.p8) for both alert and VoIP pushes, and configure it on the server (`deploy/.env`).
3. Deploy the backend and coturn with real domains: `deploy/README.md`.
4. Set `EXPO_PUBLIC_API_URL` (and optionally the WS and Sentry DSN) per EAS environment.
5. Build and test on real devices with `eas build --profile staging`, especially calls across mobile networks.
6. Store declarations:
   - Play Console: full-screen intent and foreground-service (phone call) declarations, data safety form.
   - App Store: privacy labels; in-app account deletion is already implemented.
