"""connect_delay_rename

Revision ID: d0e1f2a3b4c5
Revises: c8d9e0f1a2b3
Create Date: 2026-07-16 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd0e1f2a3b4c5'
down_revision = 'c8d9e0f1a2b3'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.alter_column(
            'redirect_delay_seconds',
            new_column_name='connect_delay_seconds',
            existing_type=sa.Integer(),
            existing_nullable=False,
        )


def downgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.alter_column(
            'connect_delay_seconds',
            new_column_name='redirect_delay_seconds',
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
