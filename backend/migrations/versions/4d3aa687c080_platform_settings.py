"""platform_settings

Revision ID: 4d3aa687c080
Revises: b5d8e1f3a0c2
Create Date: 2026-06-30 04:30:02.808507

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4d3aa687c080'
down_revision = 'b5d8e1f3a0c2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('platform_settings',
        sa.Column('key', sa.String(length=100), nullable=False),
        sa.Column('value', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('key')
    )


def downgrade():
    op.drop_table('platform_settings')
