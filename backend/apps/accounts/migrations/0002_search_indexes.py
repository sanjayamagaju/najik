"""PostgreSQL-only prefix-search indexes for user search.

``username LIKE 'ar%'`` and ``UPPER(display_name) LIKE UPPER('ar%')`` can only use a btree
index with the ``*_pattern_ops`` operator classes under non-C collations. Other databases
(SQLite in tests) skip this migration's SQL.
"""

from django.db import migrations

INDEXES = [
    (
        "user_username_prefix_idx",
        "CREATE INDEX IF NOT EXISTS user_username_prefix_idx ON accounts_user "
        "(username varchar_pattern_ops)",
    ),
    (
        "user_display_name_prefix_idx",
        "CREATE INDEX IF NOT EXISTS user_display_name_prefix_idx ON accounts_user "
        "(UPPER(display_name) varchar_pattern_ops)",
    ),
]


def create(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for _, sql in INDEXES:
        schema_editor.execute(sql)


def drop(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for name, _ in INDEXES:
        schema_editor.execute(f"DROP INDEX IF EXISTS {name}")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]

    operations = [migrations.RunPython(create, drop, elidable=False)]
