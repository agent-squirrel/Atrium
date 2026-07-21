"""add hostname to guest_sessions

Revision ID: b5d8e1f3a0c2
Revises: c9f8e3b2a1d0
Create Date: 2026-06-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'b5d8e1f3a0c2'
down_revision = 'c9f8e3b2a1d0'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('guest_sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('hostname', sa.String(length=200), nullable=True))


def downgrade():
    with op.batch_alter_table('guest_sessions', schema=None) as batch_op:
        batch_op.drop_column('hostname')
