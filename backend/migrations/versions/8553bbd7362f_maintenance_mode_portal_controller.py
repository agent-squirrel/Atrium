"""maintenance_mode_portal_controller

Revision ID: 8553bbd7362f
Revises: 4d3aa687c080
Create Date: 2026-06-30 09:43:04.517042

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8553bbd7362f'
down_revision = '4d3aa687c080'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.add_column(sa.Column('maintenance_mode', sa.Boolean(), nullable=False, server_default=sa.false()))

    with op.batch_alter_table('unifi_controllers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('maintenance_mode', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table('unifi_controllers', schema=None) as batch_op:
        batch_op.drop_column('maintenance_mode')

    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.drop_column('maintenance_mode')
