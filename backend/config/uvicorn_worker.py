"""Uvicorn worker class for gunicorn with Najik-specific settings."""

import os

from uvicorn_worker import UvicornWorker


class NajikUvicornWorker(UvicornWorker):
    CONFIG_KWARGS = {
        "loop": "auto",
        "http": "auto",
        "lifespan": "off",
        # Slightly above the 64 KiB app-level cap so the app closes oversize frames with 4009
        # instead of uvicorn closing with 1009.
        "ws_max_size": 128 * 1024,
        # Protocol-level heartbeats are handled by the app (`hb` frames).
        "ws_ping_interval": None,
        "proxy_headers": True,
        "forwarded_allow_ips": os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1"),
        "server_header": False,
    }
