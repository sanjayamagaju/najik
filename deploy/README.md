# Najik deployment runbook

Single-host production stack with Docker Compose: **Caddy** (automatic TLS, HTTP/3) →
**api** (gunicorn + uvicorn workers, one ASGI app serving REST and WebSockets) + **worker**
(Celery) + **beat** (Celery beat) + **PostgreSQL 17** + **Redis 7** (AOF) + **coturn**
(host network).

## 1. Prerequisites

- A Linux host with Docker Engine + Compose v2, a public IPv4 (IPv6 optional).
- DNS records (both pointing at the host):
  - `A api.example.com` → host IP
  - `A turn.example.com` → host IP (must be DNS-only, no CDN/proxy in front; TURN is not HTTP)
- Firewall (allow inbound):

| Port | Proto | Purpose |
| --- | --- | --- |
| 80 | TCP | ACME HTTP-01 challenge, redirect to HTTPS |
| 443 | TCP + UDP | HTTPS/WSS (UDP for HTTP/3) |
| 3478 | UDP + TCP | STUN/TURN |
| 5349 | TCP | TURN over TLS (`turns:`), works through restrictive firewalls |
| 49160–49999 | UDP | TURN relay ports (`min-port`/`max-port` in `coturn/turnserver.conf`) |
| 22 | TCP | SSH (restrict to your IPs) |

Nothing else is published: Postgres/Redis live on an internal network.

## 2. First deployment

```bash
git clone <repo> /opt/najik && cd /opt/najik/deploy
cp .env.example .env && chmod 600 .env
# Fill in: domains, ACME_EMAIL, TURN_EXTERNAL_IP, POSTGRES_PASSWORD, REDIS_PASSWORD (hex),
# SECRET_KEY, TURN_SECRET, ALLOWED_HOSTS, FCM/APNs credentials (or PUSH_LOG_ONLY=true).
docker compose build                    # or set NAJIK_IMAGE to a pushed, SHA-tagged image
docker compose up -d
docker compose ps                       # migrate exits 0; api/worker become healthy
docker compose logs -f api
```

The `migrate` service runs `manage.py migrate` before api/worker/beat start (Compose
`service_completed_successfully`). Smoke test:

```bash
curl -fsS https://api.example.com/healthz          # {"status":"ok"}
docker compose exec api python -c "import urllib.request as u;print(u.urlopen(u.Request('http://127.0.0.1:8000/readyz',headers={'Host':'api.example.com'})).read())"
```

Create an admin (only if `ADMIN_URL` is set): `docker compose run --rm api manage createsuperuser`.

## 3. TLS

- Caddy obtains and renews certificates for `API_DOMAIN` and `TURN_DOMAIN` automatically
  (data in the `caddy_data` volume — back it up or expect re-issuance after loss).
- HSTS is sent by both Caddy and Django. `SECURE_HSTS_PRELOAD` is off by default on purpose.
- **TURN TLS (5349):** coturn reads Caddy's certificate for `TURN_DOMAIN` read-only from
  `caddy_data`. On the very first boot the certificate may not exist yet when coturn starts;
  once `docker compose logs caddy` shows it was obtained, run `docker compose restart coturn`.
  Caddy renews ~30 days before expiry; restart coturn monthly (cron) so it reloads the file:
  `0 4 1 * * cd /opt/najik/deploy && docker compose restart coturn`.
  coturn runs as root only to read Caddy's 0600 key. To run it unprivileged, copy the cert/key
  into a separate volume with a renewal hook (e.g. a small cron job that copies and `chown`s
  them to uid 65534) and drop the `user: "0:0"` line.
- If Caddy falls back to ZeroSSL, set `TURN_CERT_ISSUER=acme.zerossl.com-v2-dv90`.

## 4. TURN / coturn

- `use-auth-secret` with `TURN_SECRET` (identical in the api and coturn). The API hands out
  credentials `username = "<expiry>:<user_id>"`, `credential = base64(HMAC-SHA1(secret,
  username))` valid for `TURN_CREDENTIAL_TTL_SEC` (default 1 h) via `GET /api/v1/calls/ice-servers`
  and inside `call.invite`/`call.accept` acks and `call.incoming`.
- Relays to private, loopback, link-local, CGNAT and documentation ranges are denied
  (`denied-peer-ip`), preventing SSRF into the host network. TCP relaying is disabled.
- `TURN_EXTERNAL_IP` must be the public IP (behind cloud NAT use `--external-ip=PUBLIC/PRIVATE`).
- Verify with <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/> using a
  credential from the API: you should see `relay` candidates.
- Rotate `TURN_SECRET`: update `.env`, then `docker compose up -d api worker coturn`. Calls in
  progress keep their allocations; new credentials use the new secret.

## 5. Operations

- **Logs:** JSON on stdout (`docker compose logs api worker beat`), rotated by the json-file
  driver (5 × 20 MB per container). Logs contain ids, never message bodies, tokens or SDP.
- **Metrics:** `/metrics` is blocked at Caddy. Scrape `api:8000/metrics` and
  `worker:9808` from a Prometheus container on the `backend` network
  (`docker compose exec api curl` is not installed; use the python one-liner above).
  Key series: `najik_ws_connections`, `najik_messages_total`, `najik_calls_ended_total{reason}`,
  `najik_push_total{provider,kind,result}`, `najik_call_*` histograms, `najik_rate_limited_total`.
- **Sentry:** set `SENTRY_DSN` (PII disabled; request bodies/headers scrubbed).
- **Beat:** exactly one `beat` container. It runs the call sweeper (5 s), the presence sweeper
  (30 s) and token cleanup (6 h).

## 6. Backups and restore

PostgreSQL holds everything durable. Redis holds ephemeral state (presence, live calls,
rate limits, Celery queue); its AOF is a convenience, not a backup.

```bash
# Nightly logical backup (cron), keep 14 days, then copy ./backups off-host (S3/B2/rsync).
0 3 * * * cd /opt/najik/deploy && docker compose exec -T postgres \
  pg_dump -U najik -d najik -Fc -f /backups/najik-$(date +\%F).dump \
  && find backups -name 'najik-*.dump' -mtime +14 -delete

# Restore into an empty database
docker compose stop api worker beat
docker compose exec -T postgres pg_restore -U najik -d najik --clean --if-exists /backups/najik-YYYY-MM-DD.dump
docker compose up -d api worker beat
```

Test a restore at least quarterly. For point-in-time recovery, add WAL archiving (e.g.
pgBackRest/WAL-G) or move to a managed PostgreSQL.

## 7. Releases and rollbacks

```bash
# Release: build and push an immutable, SHA-tagged image (CI), then on the host:
sed -i "s|^NAJIK_IMAGE=.*|NAJIK_IMAGE=ghcr.io/acme/najik-backend:<sha>|" .env
docker compose pull api worker beat migrate
docker compose up -d                  # migrate runs first, then api/worker/beat are recreated
```

- WebSocket clients are disconnected during an api restart and reconnect with backoff; in-flight
  calls survive (media is peer-to-peer, the 30 s reconnect grace covers signalling).
- **Migrations must be backwards compatible** with the previous release (expand → migrate
  → contract over two releases), so rolling back the image never requires a schema rollback.
- **Rollback:** set `NAJIK_IMAGE` back to the previous SHA and `docker compose up -d`. Only
  if a migration must be reverted: `docker compose run --rm api manage migrate <app> <prev>`
  *before* switching the image.

## 8. Scaling notes

- **Vertical first:** `WEB_CONCURRENCY` (uvicorn processes) ≈ CPU cores; each holds a DB pool of
  up to `DB_POOL_MAX_SIZE` connections — keep `WEB_CONCURRENCY × DB_POOL_MAX_SIZE + worker
  concurrency` below Postgres `max_connections` (200), or add PgBouncer (transaction mode).
- **Horizontal api:** stateless; any node can serve any user. WebSocket fan-out goes through the
  Redis pub/sub channel layer; presence, rate limits, call state and call deadlines live in
  Redis; call transitions are serialised by Postgres row locks. Put several api replicas behind
  Caddy (`reverse_proxy api1:8000 api2:8000` with `lb_policy least_conn`). No sticky sessions.
- **Workers:** scale `worker` freely (push queue is the hot one: `-Q push`). Keep one `beat`.
- **Redis:** single instance (no cluster: Lua scripts touch multiple keys). Use a managed Redis
  with persistence for higher availability.
- **TURN:** bandwidth-bound. Add more coturn hosts with the same `TURN_SECRET` and list all of
  them in `TURN_URLS`.
- **Limits:** `ulimit -n` ≥ 65536 on the host for many concurrent WebSockets.

## 9. Local development dependencies

`docker compose -f deploy/docker-compose.dev.yml up -d` starts Postgres, Redis and a non-TLS
coturn that allows private peers (LAN testing only). See `backend/README.md`.
