"""make timestamp columns timezone-aware

Revision ID: ff4b91d0a83d
Revises: aaf1e5899f50
Create Date: 2026-07-20 03:06:33.130592

These columns were always populated with datetime.now(timezone.utc) in
Python, but declared as naive `timestamp without time zone`, so Postgres
silently dropped the offset - the JSON the frontend received had no
Z/+00:00 suffix, and the browser's `new Date(iso)` then read it as local
time instead of UTC. The explicit `AT TIME ZONE 'UTC'` in each USING
clause is required: without it, Postgres would reinterpret the existing
naive values using the session's own timezone (not necessarily UTC)
instead of correctly treating them as the UTC values they've always been,
which would silently shift every existing timestamp during the migration.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'ff4b91d0a83d'
down_revision = 'aaf1e5899f50'
branch_labels = None
depends_on = None

# (table, column, nullable)
COLUMNS = [
    ("access_points", "last_seen_at", True),
    ("guest_sessions", "authorized_at", False),
    ("portals", "created_at", False),
    ("portals", "updated_at", False),
    ("tenants", "created_at", False),
    ("tenants", "updated_at", False),
    ("unifi_controllers", "last_synced_at", True),
    ("unifi_controllers", "created_at", False),
    ("unifi_sites", "created_at", False),
    ("users", "created_at", False),
    ("users", "last_login_at", True),
    ("vouchers", "expires_at", True),
    ("vouchers", "created_at", False),
]


def upgrade():
    for table, column, nullable in COLUMNS:
        op.alter_column(
            table, column,
            existing_type=postgresql.TIMESTAMP(),
            type_=sa.DateTime(timezone=True),
            existing_nullable=nullable,
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )


def downgrade():
    for table, column, nullable in COLUMNS:
        op.alter_column(
            table, column,
            existing_type=sa.DateTime(timezone=True),
            type_=postgresql.TIMESTAMP(),
            existing_nullable=nullable,
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )
