# syntax=docker/dockerfile:1.7
# Najik backend: one image for api (gunicorn + uvicorn workers, HTTP + WebSocket), celery
# worker, celery beat and one-off management commands (see docker-entrypoint.sh).

ARG PYTHON_VERSION=3.13

FROM python:${PYTHON_VERSION}-slim AS builder
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements/ /tmp/requirements/
RUN pip install -r /tmp/requirements/prod.txt

FROM python:${PYTHON_VERSION}-slim AS runtime
ARG RELEASE=dev
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    DJANGO_ENV=production \
    RELEASE=${RELEASE} \
    PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus

RUN groupadd --system --gid 10001 najik \
 && useradd --system --uid 10001 --gid najik --home-dir /app --shell /usr/sbin/nologin najik

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --chown=najik:najik . /app

# Static files (admin only) are collected at build time with throwaway, build-only settings.
RUN mkdir -p "$PROMETHEUS_MULTIPROC_DIR" \
 && SECRET_KEY=build-only-placeholder-not-used-at-runtime-0123456789abcdef \
    DATABASE_URL=postgres://build@localhost/build \
    REDIS_URL=redis://localhost:6379/0 \
    ALLOWED_HOSTS=build \
    TURN_SECRET=build TURN_URLS=turn:build STUN_URLS=stun:build \
    PUSH_LOG_ONLY=true \
    python manage.py collectstatic --noinput -v 0 \
 && rm -rf "$PROMETHEUS_MULTIPROC_DIR" \
 && chmod +x /app/docker-entrypoint.sh

USER najik
EXPOSE 8000

# Liveness only; readiness (/readyz) is for orchestrators that support it.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,sys,urllib.request as u; h=os.environ.get('ALLOWED_HOSTS','localhost').split(',')[0]; r=u.urlopen(u.Request('http://127.0.0.1:8000/healthz', headers={'Host': h}), timeout=4); sys.exit(0 if r.status == 200 else 1)"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["api"]
