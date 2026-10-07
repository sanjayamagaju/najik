#!/bin/sh
# Usage: docker-entrypoint.sh api|worker|beat|migrate|manage <args>|<any command>
set -eu

if [ -n "${PROMETHEUS_MULTIPROC_DIR:-}" ]; then
  rm -rf "$PROMETHEUS_MULTIPROC_DIR"
  mkdir -p "$PROMETHEUS_MULTIPROC_DIR"
fi

cmd="${1:-api}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
  api)
    exec gunicorn config.asgi:application -c config/gunicorn.conf.py "$@"
    ;;
  worker)
    exec celery -A config worker \
      --loglevel "${CELERY_LOG_LEVEL:-info}" \
      --queues default,push,realtime \
      --concurrency "${CELERY_CONCURRENCY:-4}" \
      --without-gossip --without-mingle "$@"
    ;;
  beat)
    # Run exactly ONE beat instance per deployment.
    exec celery -A config beat --loglevel "${CELERY_LOG_LEVEL:-info}" \
      --schedule /tmp/celerybeat-schedule "$@"
    ;;
  migrate)
    exec python manage.py migrate --noinput "$@"
    ;;
  manage)
    exec python manage.py "$@"
    ;;
  *)
    exec "$cmd" "$@"
    ;;
esac
