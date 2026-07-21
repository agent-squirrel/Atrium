"""portal_customization

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-07-16 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b7c8d9e0f1a2'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ssids', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('font_family', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('layout', sa.String(length=20), nullable=False, server_default='centered'))
        batch_op.add_column(sa.Column('require_terms_acceptance', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('terms_checkbox_label', sa.String(length=300), nullable=True))
        batch_op.add_column(sa.Column('terms_url', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('social_facebook', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('social_instagram', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('social_twitter_x', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('social_tiktok', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('promo_banner_path', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('promo_banner_link', sa.String(length=500), nullable=True))

    # Migrate the existing single-SSID string into the new list column,
    # preserving real data, before dropping the old column.
    op.execute("""
        UPDATE portals SET ssids = CASE
            WHEN ssid IS NOT NULL AND ssid != '' THEN json_build_array(ssid)
            ELSE '[]'::json
        END
    """)

    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.alter_column('ssids', existing_type=sa.JSON(), nullable=False)
        batch_op.drop_column('ssid')


def downgrade():
    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ssid', sa.String(length=200), nullable=True))

    op.execute("""
        UPDATE portals SET ssid = ssids->>0
        WHERE ssids IS NOT NULL AND json_array_length(ssids) > 0
    """)

    with op.batch_alter_table('portals', schema=None) as batch_op:
        batch_op.drop_column('promo_banner_link')
        batch_op.drop_column('promo_banner_path')
        batch_op.drop_column('social_tiktok')
        batch_op.drop_column('social_twitter_x')
        batch_op.drop_column('social_instagram')
        batch_op.drop_column('social_facebook')
        batch_op.drop_column('terms_url')
        batch_op.drop_column('terms_checkbox_label')
        batch_op.drop_column('require_terms_acceptance')
        batch_op.drop_column('layout')
        batch_op.drop_column('font_family')
        batch_op.drop_column('ssids')
