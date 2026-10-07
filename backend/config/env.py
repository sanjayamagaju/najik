"""Selects the settings module from ``DJANGO_ENV``."""

import os

ENVIRONMENTS = ("development", "staging", "production", "test")


def settings_module() -> str:
    """Return the settings module for ``DJANGO_ENV`` (development by default)."""
    name = os.environ.get("DJANGO_ENV", "development").strip().lower()
    if name not in ENVIRONMENTS:
        raise RuntimeError(f"DJANGO_ENV must be one of {ENVIRONMENTS}, got {name!r}")
    return f"config.settings.{name}"


def configure() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", settings_module())
