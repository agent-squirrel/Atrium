import logging
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None

CHECK_INTERVAL_MINUTES = 30
CLEANUP_INTERVAL_HOURS = 24


def init_scheduler(app) -> None:
    global _scheduler
    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.add_job(
        _sync_due_controllers,
        "interval",
        minutes=CHECK_INTERVAL_MINUTES,
        args=[app],
        id="controller_auto_sync",
        coalesce=True,
        max_instances=1,
        # small initial delay so startup DB connections settle first
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    # Cleanup jobs - both are no-ops unless something's actually due for
    # deletion (guest-data purge only acts on portals/settings with an
    # explicit retention window; voucher purge only ever touches
    # already-dead, never-redeemed vouchers). Staggered a little so they
    # don't all fire in the same instant as the controller sync's first run.
    _scheduler.add_job(
        _purge_guest_data_job,
        "interval",
        hours=CLEANUP_INTERVAL_HOURS,
        args=[app],
        id="guest_data_purge",
        coalesce=True,
        max_instances=1,
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=60),
    )
    _scheduler.add_job(
        _purge_vouchers_job,
        "interval",
        hours=CLEANUP_INTERVAL_HOURS,
        args=[app],
        id="voucher_purge",
        coalesce=True,
        max_instances=1,
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=90),
    )
    _scheduler.start()
    logger.info(
        "Background scheduler started (controller auto-sync every %dm, cleanup jobs every %dh)",
        CHECK_INTERVAL_MINUTES, CLEANUP_INTERVAL_HOURS,
    )


def _sync_due_controllers(app) -> None:
    with app.app_context():
        from app.models import UnifiController
        from app.extensions import db
        from app.services.unifi import UnifiClient, UnifiError
        from app.api.controllers import _do_sync

        now = datetime.now(timezone.utc)
        controllers = (
            UnifiController.query
            .filter(
                UnifiController.sync_interval_hours.isnot(None),
                UnifiController.is_active.is_(True),
            )
            .all()
        )

        for controller in controllers:
            try:
                interval = timedelta(hours=controller.sync_interval_hours)
                last = controller.last_synced_at
                if last is not None:
                    last_utc = last.replace(tzinfo=timezone.utc)
                    if now - last_utc < interval:
                        continue  # not yet due
                logger.info("Auto-syncing controller %d (%s)", controller.id, controller.name)
                client = UnifiClient(controller)
                _do_sync(controller, client)
                logger.info("Auto-sync complete for controller %d", controller.id)
            except Exception:
                logger.exception("Auto-sync failed for controller %d (%s)", controller.id, controller.name)
                db.session.rollback()


def _purge_guest_data_job(app) -> None:
    with app.app_context():
        from app.extensions import db
        from app.api.guests import purge_guest_data

        try:
            n = purge_guest_data()
            if n:
                logger.info("Scheduled guest-data purge deleted %d session(s)", n)
        except Exception:
            logger.exception("Scheduled guest-data purge failed")
            db.session.rollback()


def _purge_vouchers_job(app) -> None:
    with app.app_context():
        from app.extensions import db
        from app.api.vouchers import purge_expired_vouchers

        try:
            n = purge_expired_vouchers()
            if n:
                logger.info("Scheduled voucher purge deleted %d voucher(s)", n)
        except Exception:
            logger.exception("Scheduled voucher purge failed")
            db.session.rollback()
