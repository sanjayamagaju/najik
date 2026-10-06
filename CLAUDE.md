# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Najik: a 1-to-1 chat + WebRTC voice/video calling app for Android. Two **independent npm packages** (no workspaces). The root `package.json` only proxies scripts.

- `server/`: Node.js (≥ 22.13, uses built-in `node:sqlite`) + Express 5 + Socket.IO + SQLite. REST API, realtime messaging, call signaling, FCM push.
- `app/`: React 19 + Vite 8 + Tailwind 4 + Motion, packaged as an Android APK with Capacitor 8. `app/android/` is a committed, **hand-customised** native project.
- `deploy/`: docker-compose (server + coturn TURN).

`README.md` is the user-facing guide: setup, every env var, APK build/signing, Firebase, troubleshooting. Keep it in sync when changing env vars, scripts or build steps.

## Commands

```bash
npm run install:all           # npm install in server/ and app/
npm run dev:server            # server with tsx watch; server/.env is optional (JWT secret auto-generated into server/data/jwt-secret)
npm run dev:app               # Vite on :5173, proxies /api and /socket.io to DEV_PROXY_TARGET (default http://localhost:4000)
cd server && npm run typecheck
cd app && npm run typecheck   # tsc -b
cd app && npm run build       # typecheck + vite build
cd app && npm run android:sync   # vite build + cap sync android (required before every APK build)
```

- **There is no test suite or linter.** Verify changes with both typechecks plus `vite build`.
- The server can be started ad hoc with a throwaway DB: `DATABASE_PATH=<tmp>/najik.db PORT=4123 npx tsx src/index.ts` (a JWT secret is generated next to the DB). Health check: `GET /api/health`.
- Set `FCM_LOG_ONLY=1` to print push payloads instead of sending them. This makes push-driven call flows testable without Firebase.
- Realtime behaviour is easiest to verify with a script using `socket.io-client` (installed in `app/node_modules`) against a temp server.
- UI and calls can be verified in headless Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. Use two separate browser contexts: the auth token lives in `localStorage`, so one context = one user.
- Android cannot be built on this machine (no Android SDK; system Java is 8). Java/Gradle changes under `app/android` are **unverified until the user builds**. Double-check Android/Capacitor APIs against `app/node_modules/@capacitor/android` sources.
- **Zero-config is a requirement:** a fresh clone must run and build with no env files.
  - `server/src/config/env.ts` auto-generates `JWT_SECRET`.
  - `app/vite.config.ts` bakes in this PC's default-route LAN address as `VITE_SERVER_URL` when it's unset.
  - Cleartext `http://` is allowed by default: `androidScheme: 'http'` in `capacitor.config.ts`, plus the `usesCleartextTraffic` manifest placeholder in `app/android/app/build.gradle`.
  - HTTPS-only releases use `NAJIK_HTTPS_ONLY=1` + `-PnajikHttpsOnly=true`.
  - Capacitor's `server.cleartext` option does **not** affect the manifest, so don't rely on it.
- Never re-run `cap add android`. It would overwrite the customised native project (manifest, Java plugins, icons, styles, signing config).

## Toolchain gotchas (all newer majors)

- **TypeScript 7.** The server is ESM/NodeNext, so relative imports need `.js` extensions.
- **React Router 8:** import from `react-router`.
- **Motion:** import from `motion/react`. Transforms set via `animate`/`style` override Tailwind `translate-*` classes; use `style={{ x: '-50%' }}` instead.
- **Tailwind 4:** CSS-first config, no `tailwind.config`. Design tokens are CSS variables in `app/src/index.css` (`:root`, overridden by `.dark`) and mapped through `@theme inline`. Custom utilities: `glass`, `brand-gradient`, `brand-text`, `shadow-soft`, `shadow-glow`, `pt-safe`/`pb-safe`.
- **Zod 4, Express 5.** Async route errors propagate automatically; throw `HttpError` from `server/src/utils/http.ts`.
- `node:sqlite` emits an ExperimentalWarning; this is expected.

## Architecture

### Auth and server address
- JWT **Bearer** tokens, stored in `localStorage` (not cookies, because the Android WebView talks cross-origin to the server).
- Each user row has a `token_version`. Logout bumps it, which revokes all of that user's tokens, disconnects their sockets and deletes their push tokens.
- Sockets authenticate via `handshake.auth.token`.
- The client resolves the server URL in `app/src/lib/config.ts`. Priority: the in-app ⚙ override in `localStorage`, then `VITE_SERVER_URL` (build time), then same-origin (the dev proxy).
- Allowed CORS origins = the Capacitor origins (always) + `CORS_ORIGINS`.

### Realtime contract
- Socket event names are string literals that must match across three places:
  - server: `server/src/realtime/chat.ts`, `server/src/realtime/calls.ts`
  - client listeners: `app/src/realtime/bindings.ts`
  - client emits: the stores
- Acks use the shape `{ ok: true, ... } | { ok: false, error }`. The client wraps them in `emitAck()` (`app/src/lib/socket.ts`), which rejects on error or timeout.
- Users join the room `user:<id>`, so multi-device fan-out happens through rooms.
- Presence is broadcast only to users with shared message history.
- Every inbound socket event goes through a per-connection token bucket.

### Messages
- Sends are optimistic. The client generates a `clientId`, and the server dedupes on `(sender_id, client_id)`, so retries are idempotent.
- The UI keys messages by `clientId ?? id`.
- Delivery status is derived from `deliveredAt` / `readAt` (`statusOf()` in `app/src/stores/chat.ts`):
  - the recipient emits `message:delivered`
  - viewing a chat emits `message:read`
  - on connect, the server marks everything pending as delivered
- `kind` is `text | ping | call`. Call-log messages are written **server-side** when a call finishes (`finish()` in `calls.ts`).

### Calls (signaling)
- Call state lives in **in-memory maps** in `calls.ts`, so the server is single-instance. Horizontal scaling would need the Redis adapter and shared call state.
- Signaling is relayed only between the two bound socket ids of an active call.
- **Only the caller sends offers**, including for ICE restarts; the callee requests one with `{type:'restart'}`. This avoids glare. Don't add callee-initiated renegotiation.
- On disconnect there is a 20 s grace period; the reconnecting client sends `call:rejoin`.
- Client-side, `app/src/stores/call.ts` is the call state machine. It owns one `CallSession` (`app/src/webrtc/CallSession.ts`) and is driven by socket events.

### Call quality (YouTube-style)
- Each user picks the quality they **receive**. The preference travels over a negotiated DataChannel (`id: 0`, label `ctl`) to the peer.
- The peer's sender applies it with `RTCRtpSender.setParameters` (`maxBitrate`, `scaleResolutionDownBy`, `maxFramerate`, `active`, `degradationPreference`). On "Auto", `AdaptiveController` decides instead.
- Levels are defined in `webrtc/quality.ts`.
- `webrtc/adaptive.ts` is pure logic fed by `webrtc/stats.ts` samples. It can be exercised standalone with `tsx` by feeding synthetic `CallStats`.
- Opus FEC/DTX/bitrate munging (`webrtc/sdp.ts`) is applied only to the SDP **sent to the peer**, never to `setLocalDescription`.

### Push for incoming calls
- The server sends **data-only** FCM messages (`server/src/push/fcm.ts`) when a call is invited. If the callee is offline, the call still rings when they have a push token.
- It sends `call-end` pushes to dismiss notifications (decline, cancel, timeout, answered elsewhere).
- When a device connects, `deliverPendingCall()` re-sends any still-ringing call. The client's `onIncoming` ignores duplicates of the current `callId`.
- Native side (`app/android/app/src/main/java/com/najik/app/`):
  - `NajikMessagingService` shows a CallStyle notification (`CallNotifications`), unless `MainActivity.isInForeground()`.
  - **Decline** → `CallActionReceiver` → `POST /api/calls/:id/decline`, using the session that `PushStore` mirrored from JS.
  - **Answer** / tap → `MainActivity` intent → `NajikPushPlugin` retained `callAction` event → `useCall.handleCallAction` (stored as `pendingAction` until the socket delivers the call).
- Push is active only when `app/android/app/google-services.json` exists (Gradle applies google-services conditionally) and the server has Firebase credentials.

### Native bridges
- Local Capacitor plugins (`CallAudioPlugin`, `NajikPushPlugin`) are registered in `MainActivity.onCreate` **before** `super.onCreate`.
- Their JS wrappers are `app/src/lib/callAudio.ts` and `app/src/lib/push.ts` (via `registerPlugin`). They no-op on the web, using `isNative` from `lib/config.ts`.
- When adding a plugin method, update both the Java class and the TS interface.

### Client conventions
- State lives in Zustand stores (`app/src/stores/*`). Socket → store wiring is in `realtime/bindings.ts`, bound/unbound by the auth store on sign-in/out.
- **Android back button:** `App.tsx` dispatches a cancelable `najik:back` window event. Overlays (e.g. `components/Sheet.tsx`) call `preventDefault()` to consume it. Otherwise the handler minimises the call, then leaves the chat, then minimises the app.
- **Layout:** mobile uses a single stack with the chat sliding over the list (`features/chat/Shell.tsx`). At ≥ 768 px it switches to a two-pane layout.
- Theme = the `dark` class on `<html>`, applied pre-paint by an inline script in `app/index.html`.
- All sounds are synthesised with WebAudio (`lib/sounds.ts`); there are no audio assets.

### Server configuration
- All env vars are validated by the Zod schema in `server/src/config/env.ts`; the server exits with a per-variable message if any is invalid.
- Adding a variable means updating the schema, `server/.env.example`, and the README table (§2.1).
- The DB schema is created idempotently in `server/src/db/index.ts`. There is no migration tool, so schema changes need additive `CREATE ... IF NOT EXISTS` / `ALTER` handling.
- Repositories (`db/users.ts`, `db/messages.ts`, `db/pushTokens.ts`) wrap prepared statements.
