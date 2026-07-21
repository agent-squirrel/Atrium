"""add access_points table for AP-MAC to site mapping

Revision ID: c9f8e3b2a1d0
Revises: 31b79265ef4f
Create Date: 2026-06-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'c9f8e3b2a1d0'
down_revision = '31b79265ef4f'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'access_points',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('mac_address', sa.String(length=17), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=True),
        sa.Column('model', sa.String(length=100), nullable=True),
        sa.Column('site_id', sa.Integer(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['site_id'], ['unifi_sites.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('mac_address'),
    )
    op.create_index('ix_access_points_mac_address', 'access_points', ['mac_address'], unique=True)


def downgrade():
    op.drop_index('ix_access_points_mac_address', table_name='access_points')
    op.drop_table('access_points')
