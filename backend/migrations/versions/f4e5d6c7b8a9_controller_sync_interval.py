"""controller_sync_interval

Revision ID: f4e5d6c7b8a9
Revises: e3f1a2b4c5d6
Create Date: 2026-07-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'f4e5d6c7b8a9'
down_revision = 'e3f1a2b4c5d6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('unifi_controllers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sync_interval_hours', sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table('unifi_controllers', schema=None) as batch_op:
        batch_op.drop_column('sync_interval_hours')
