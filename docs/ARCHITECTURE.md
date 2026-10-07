# Najik architecture

Najik is a focused 1-to-1 messaging and calling app. It offers text with emoji, presence, typing, receipts, Ping, audio calls and video calls, plus push notifications.

It deliberately has no groups, stories, channels, feeds or payments.

## Repository layout

```
backend/   Django 6 + DRF + Channels (ASGI) + Celery. PostgreSQL, Redis
mobile/    Expo (SDK 57) + React Native + TypeScript + Expo Router + Zustand
deploy/    Production docker-compose: Caddy (TLS), api (ASGI), celery worker/beat, Postgres, Redis, coturn
docs/      PROTOCOL.md is the API/WebSocket contract. This file holds the decisions
.github/   CI (backend tests, mobile typecheck/lint/tests) and EAS build workflows
```

## Key decisions

| Area | Decision | Why |
| --- | --- | --- |
| Transport | One authenticated WebSocket per app instance carries messaging, receipts, typing, presence, ping and call signaling. REST covers history, sync and anything idempotent | one socket is cheap on mobile radios; REST keeps sync simple and cacheable |
| WS auth | First-frame `auth` message, not a query-string token | tokens stay out of proxy/access logs |
| Ordering & sync | Per-conversation gap-free `seq` (assigned under `SELECT … FOR UPDATE` on the conversation row). The client syncs with `after_seq` | deterministic gap detection and resync after reconnect |
| Receipts | Per-member watermarks (`delivered_seq`, `read_seq`) instead of per-message rows | O(1) writes per receipt; status is derived |
| Idempotency | `client_id` UUID per message, unique per sender | retries after flaky networks never duplicate |
| Fan-out | Channels groups `user.<id>` via `channels_redis` (pub/sub layer). Any API instance can reach any user | horizontal scaling of WS nodes |
| Presence | Redis: per-user set of live connection IDs with a heartbeat TTL, plus an `active` flag per connection. Last-seen is persisted to Postgres on going offline | survives node crashes (TTL); no DB writes on every heartbeat |
| Calls | Server-authoritative state in Redis with Celery-free timers (`asyncio` + Redis key expiry checks) and a periodic Celery beat sweeper as backstop. Rows in Postgres for history | correctness across multiple ASGI nodes |
| Media | P2P WebRTC with STUN + TURN (coturn, ephemeral HMAC credentials). **No SFU**: the product is strictly 1-to-1, where P2P is lower-latency and cheaper. An SFU (LiveKit) would only be needed for groups, recording or server-side processing, all out of scope | lowest latency, no media servers to scale |
| Quality | Client-side adaptive controller over `RTCRtpSender.setParameters` (bitrate, `scaleResolutionDownBy`, `maxFramerate`, `degradationPreference`) driven by `getStats()`. Manual YouTube-style override, applied live | no renegotiation needed for most changes |
| Tokens | Short-lived JWT access tokens (15 min) and rotating refresh tokens bound to a `Session` row, with reuse detection | revocable per device |
| Secrets on device | Refresh and access tokens live in Expo SecureStore (Keychain / Keystore). AsyncStorage only holds non-sensitive caches | |
| Push | FCM HTTP v1 (Android) and APNs token-based HTTP/2 (iOS, including VoIP pushes), sent from Celery tasks | push latency never blocks the request path |
| Config | `DJANGO_ENV` = development \| staging \| production (backend) and `APP_ENV` (mobile, set per EAS build profile). Everything environment-specific comes from env vars | |
| Observability | JSON structured logs (structlog) with request/connection IDs and no PII or message bodies. Sentry on both sides. Prometheus metrics. `/healthz` and `/readyz` | |

## Adaptive quality (summary)

These are the video ladder presets (send-side):

| Preset | Max resolution | fps | Max bitrate |
| --- | --- | --- | --- |
| 1080p | 1920×1080 | 30 | 3.5 Mbps |
| 720p | 1280×720 | 30 | 1.8 Mbps |
| 480p | 854×480 | 30 | 900 kbps |
| 360p | 640×360 | 24 | 550 kbps |
| 240p | 426×240 | 20 | 300 kbps |
| 144p | 256×144 | 15 | 150 kbps |

Audio uses Opus:

| Preset | Bitrate | Settings |
| --- | --- | --- |
| High | 64 kbps | stereo off, FEC on, DTX off |
| Medium | 32 kbps | |
| Low | 16 kbps | DTX on |

How the controller works:
- **Auto** samples `getStats()` every 2 s. It reads the available outgoing bitrate, RTT, packet loss and jitter, plus `qualityLimitationReason`.
  - It **downgrades fast**: two bad samples in a row.
  - It **upgrades slowly**: ten good samples plus a probe headroom of at least 1.3× the next tier's bitrate.
  - It never exceeds the camera's capture resolution or the device class cap. Low-end devices are capped at 480p.
- **YouTube semantics:** the user's choice sets the quality of the media they *receive*.
  - Changing it sends `call.signal{type:"quality", video, audio}` to the peer.
  - The peer's sender applies `min(requested cap, its own uplink Auto decision)` live through `setParameters`, with no renegotiation.
  - "Auto" means no cap. Each side's Auto controller always protects its own uplink.
- Under severe congestion, a manual cap may be temporarily undercut so the call never freezes. It is restored when the network recovers, and the UI shows "Auto-limited" in the meantime.
