import logging
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None

CHECK_INTERVAL_MINUTES = 30


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
    _scheduler.start()
    logger.info("Background scheduler started (controller auto-sync checks every %dm)", CHECK_INTERVAL_MINUTES)


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
