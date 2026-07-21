"""add controller_type column

Revision ID: b2c3d4e5f6a7
Revises: f4e5d6c7b8a9
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a7'
down_revision = 'f4e5d6c7b8a9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'unifi_controllers',
        sa.Column('controller_type', sa.String(20), nullable=False, server_default='self_hosted'),
    )
    # url was NOT NULL - relax it so cloud rows can omit it
    op.alter_column('unifi_controllers', 'url', nullable=True)


def downgrade():
    op.alter_column('unifi_controllers', 'url', nullable=False)
    op.drop_column('unifi_controllers', 'controller_type')
