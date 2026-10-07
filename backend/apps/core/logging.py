"""structlog configuration: JSON in staging/production, pretty console in development.

A scrubbing processor redacts sensitive keys as defence in depth. Code must still never pass
message bodies, tokens, passwords or SDP to the logger in the first place.
"""

from __future__ import annotations

from typing import Any

import structlog

SENSITIVE_KEYS = frozenset(
    {
        "password",
        "new_password",
        "current_password",
        "token",
        "access",
        "refresh",
        "authorization",
        "body",
        "preview",
        "sdp",
        "candidate",
        "signal",
        "credential",
        "secret",
    }
)


def scrub_sensitive(_: Any, __: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    for key in event_dict.keys() & SENSITIVE_KEYS:
        event_dict[key] = "[redacted]"
    return event_dict


def _shared_processors() -> list[Any]:
    return [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        scrub_sensitive,
    ]


def configure_structlog() -> None:
    """Route structlog through stdlib logging; rendering is chosen by the formatter."""
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *_shared_processors(),
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.StackInfoRenderer(),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


def build_logging_config(*, json: bool, level: str) -> dict[str, Any]:
    renderer: Any = (
        structlog.processors.JSONRenderer() if json else structlog.dev.ConsoleRenderer(colors=False)
    )
    final = [structlog.stdlib.ProcessorFormatter.remove_processors_meta]
    if json:
        final.append(structlog.processors.format_exc_info)
    final.append(renderer)
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "structured": {
                "()": structlog.stdlib.ProcessorFormatter,
                "processors": final,
                "foreign_pre_chain": _shared_processors(),
            }
        },
        "handlers": {
            "console": {"class": "logging.StreamHandler", "formatter": "structured"},
        },
        "root": {"handlers": ["console"], "level": level},
        "loggers": {
            "django.request": {"level": "ERROR", "propagate": True},
            # The access log comes from AccessLogMiddleware; silence duplicates.
            "django.server": {"level": "WARNING", "propagate": True},
            "uvicorn.access": {"level": "WARNING", "propagate": True},
            "django.channels.server": {"level": "WARNING", "propagate": True},
            "httpx": {"level": "WARNING", "propagate": True},
            "httpcore": {"level": "WARNING", "propagate": True},
        },
    }


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
