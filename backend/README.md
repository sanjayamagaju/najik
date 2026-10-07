# Najik backend

Django 6 + DRF + Channels (ASGI) + Celery, PostgreSQL and Redis. Implements
[`docs/PROTOCOL.md`](../docs/PROTOCOL.md) (REST + WebSocket contract) and the decisions in
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Layout

```
config/            settings/{base,development,staging,production,test}.py, asgi.py, urls.py,
                   celery.py, gunicorn.conf.py, uvicorn_worker.py, env.py (DJANGO_ENV -> settings)
apps/core/         errors + DRF exception handler, Redis clients, GCRA rate limiter, structlog
                   config, request-id/access-log middleware, health, Prometheus metrics, Sentry
apps/accounts/     User, Session, RefreshToken, PushToken; JWT auth; auth/users/devices API
apps/chat/         Conversation, ConversationMember (watermarks, unread), Message; REST API
apps/calls/        Call, CallMetrics; state machine (services.py), Redis call state, timers,
                   TURN credentials; REST API
apps/realtime/     WebSocket consumer (/ws/v1/), frame schemas, presence, channel-layer events
apps/push/         FCM HTTP v1 + APNs (alert/VoIP/background) providers, payloads, Celery tasks
tests/             pytest suite (REST, WebSocket, calls, push, ops; Postgres-only concurrency)
```

## Quick start (no Docker needed)

```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate      # Windows Git Bash; .venv/bin/activate elsewhere
pip install -r requirements/dev.txt
cp .env.example .env                                  # optional; defaults work out of the box
python manage.py migrate
python manage.py createsuperuser                      # optional, admin at /admin/
uvicorn config.asgi:application --reload --port 8000 --lifespan off
```

With `DATABASE_URL`/`REDIS_URL` unset, development uses SQLite, an in-process **fakeredis**
server, the in-memory channel layer, eager Celery tasks and log-only push. That is a single
process: run exactly one uvicorn worker. Android emulators reach the host at `10.0.2.2:8000`.

### With real Postgres/Redis/coturn

```bash
docker compose -f ../deploy/docker-compose.dev.yml up -d
# backend/.env:
#   DATABASE_URL=postgres://najik:najik@localhost:5432/najik
#   REDIS_URL=redis://localhost:6379/0
#   TURN_SECRET=dev-turn-secret
#   TURN_URLS=turn:<LAN IP>:3478?transport=udp,turn:<LAN IP>:3478?transport=tcp
#   STUN_URLS=stun:<LAN IP>:3478
python manage.py migrate
uvicorn config.asgi:application --reload --port 8000 --lifespan off
celery -A config worker -B -l info -Q default,push,realtime   # worker + beat in one dev process
```

`celery -B` is for development only; production runs exactly one separate `beat`.

## Tests and linting

```bash
pytest                       # SQLite + fakeredis (with Lua) + in-memory channel layer
pytest -k calls -x           # a subset
DATABASE_URL=postgres://najik:najik@localhost:5432/najik pytest -m postgres   # row-lock tests
ruff check . && ruff format --check .
python manage.py makemigrations --check --dry-run
```

Tests marked `postgres` (concurrent seq assignment, idempotent retries, unread exactness
under concurrency) are skipped unless `DATABASE_URL` points at PostgreSQL.

## Configuration

Every variable is documented in [`.env.example`](.env.example). `DJANGO_ENV` selects
`config.settings.<env>`. Staging and production refuse to start without `SECRET_KEY` (>= 50
chars), PostgreSQL `DATABASE_URL`, `REDIS_URL`, `ALLOWED_HOSTS`, `TURN_SECRET`, `TURN_URLS`,
`STUN_URLS` and push credentials (unless `PUSH_LOG_ONLY=true`). Check a configuration with
`python manage.py check --deploy`.

## How things work

- **Auth.** Access JWT (HS256, 15 min, claims `sub sid jti exp iat type`). Refresh tokens are
  opaque 256-bit strings stored as SHA-256 hashes in `RefreshToken`, one chain per `Session`.
  Refresh rotates; presenting a rotated token revokes the session. Revocation writes a Redis
  marker (`nj:revoked:<sid>`, TTL > access lifetime) so per-request checks are one `EXISTS`
  (DB fallback if Redis is down), deletes the session's push tokens and sends
  `session.revoked` + close `4004` to its sockets (group `s.<sid>`).
- **Messages.** `seq` is assigned under `SELECT ... FOR UPDATE` on the conversation row;
  idempotency is checked after taking the lock (unique `(sender, client_id)` as backstop).
  `ConversationMember.unread_count` is denormalised and only changes under the same lock (send:
  `+1`, read: exact recount of peer messages above the new `read_seq`). Watermarks only move
  forward and are clamped to `last_seq`.
- **WebSocket.** `apps/realtime/consumer.py`: first-frame auth (10 s), strict pydantic frame
  schemas (unknown fields/types rejected, no coercion), one ack per `id`, 64 KiB cap (4009),
  idle close after `2 x heartbeat` (1001), per-connection GCRA limits, abuse close (4008).
- **Presence.** Redis sorted sets of live connection ids with expiry scores per user/session
  (refreshed by `hb`), plus an `online` set; a Lua script makes transitions atomic so exactly
  one node broadcasts each online/offline change to `p.<user>` subscribers (only users who share
  a conversation can subscribe). A beat task marks users offline whose node died.
- **Calls.** `apps/calls/services.py` is the state machine; Postgres row locks make every
  transition idempotent. Redis holds the live call hash (signal relay authorisation without DB
  hits), busy claims (`SET NX`), session bindings and deadlines (`call_deadlines` zset). Ring
  timeout (45 s) and reconnect grace (30 s) are enforced by an in-process asyncio timer, optional
  Celery countdown tasks (`CALL_TIMERS_USE_CELERY`) and the 5 s beat sweeper (node-crash
  backstop). Ending a call writes an idempotent `kind:"call"` message.
- **Push.** Fan-out tasks enqueue one `deliver_push` per token (retry with exponential backoff
  on 429/5xx, de-duplicated via Redis, invalid tokens deleted). Message/ping pushes only when the
  recipient has no `active` connection; call pushes always (FCM data-only high priority, APNs
  VoIP when a VoIP token exists, else a time-sensitive alert); `call.ended` is pushed as an FCM
  data / APNs background push so ringing stops (never VoIP, per Apple's CallKit rules).
- **Observability.** structlog (JSON outside development) with `request_id`/`user_id`/
  `session_id` context and a redaction processor; never logs bodies, tokens, passwords or SDP.
  Sentry with `send_default_pii=False` and a scrubbing `before_send`. Prometheus at `/metrics`
  when `METRICS_ENABLED=true` (multiprocess-aware); the Celery worker serves its own metrics on
  `WORKER_METRICS_PORT`.

## Useful commands

```bash
python manage.py shell -c "from apps.calls.services import sweep; print(sweep())"
celery -A config call apps.realtime.tasks.sweep_presence
celery -A config call apps.accounts.tasks.cleanup_expired_tokens
```
