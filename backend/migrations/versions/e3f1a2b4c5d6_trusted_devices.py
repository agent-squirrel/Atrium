"""trusted_devices

Revision ID: e3f1a2b4c5d6
Revises: 8752125da1d0
Create Date: 2026-07-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'e3f1a2b4c5d6'
down_revision = '8752125da1d0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'trusted_devices',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('trusted_devices', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_trusted_devices_token'), ['token'], unique=True)
        batch_op.create_index(batch_op.f('ix_trusted_devices_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('trusted_devices', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_trusted_devices_user_id'))
        batch_op.drop_index(batch_op.f('ix_trusted_devices_token'))
    op.drop_table('trusted_devices')
