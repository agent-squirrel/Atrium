"""card_opacity

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-07-16 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c8d9e0f1a2b3'
down_revision = 'b7c8d9e0f1a2'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.add_column(sa.Column('card_opacity', sa.Integer(), nullable=False, server_default='97'))


def downgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.drop_column('card_opacity')
