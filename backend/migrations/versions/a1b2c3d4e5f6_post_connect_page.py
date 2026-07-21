"""post_connect_page

Revision ID: a1b2c3d4e5f6
Revises: b2c3d4e5f6a7
Create Date: 2026-07-15 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.add_column(sa.Column('post_connect_heading', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('post_connect_text', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('redirect_delay_seconds', sa.Integer(), nullable=False, server_default='5'))


def downgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.drop_column('redirect_delay_seconds')
        batch_op.drop_column('post_connect_text')
        batch_op.drop_column('post_connect_heading')
