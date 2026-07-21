"""
Portal dispatch - handles UniFi's external captive portal redirect.

When an IP address is entered in UniFi → Client Devices → Hotspot →
Landing Page, UniFi redirects connecting guests to:

  http://<ip>/guest/s/<site_name>/?id=<mac>&ap=<ap_mac>&ssid=<ssid>&t=<ts>&url=<url>

The site_name in the path is UniFi's internal site ID (e.g. "default" or a hash).
This maps directly to UnifiSite.unifi_site_id, so we can resolve the correct portal
without needing to know anything about the URL in advance.

Lookup order:
  1. Match UnifiSite by unifi_site_id from the URL path.
  2. Among that site's portals, prefer one whose ssids list contains the SSID param.
     If no SSID-specific portal exists, fall back to the site-wide portal (empty ssids).
  3. If multiple controllers share the same internal site name, use the AP MAC
     (via the access_points table) to pick the right one.
  4. Last resort: SSID-only search across all sites (covers un-synced sites).
"""

import logging
from flask import request, redirect, url_for, render_template_string
from app.models import AccessPoint, UnifiSite, Portal
from . import dispatch_bp

logger = logging.getLogger(__name__)

_ERROR_PAGE = """
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Portal not found</title>
<style>
  body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
       min-height:100vh;margin:0;background:#f3f4f6}
  .box{background:#fff;border-radius:12px;padding:2rem 2.5rem;max-width:420px;
       text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1)}
  h1{font-size:1.25rem;color:#111;margin-bottom:.5rem}
  p{color:#6b7280;font-size:.95rem}
</style>
</head>
<body><div class="box">
  <h1>Portal not found</h1>
  <p>{{ message }}</p>
</div></body>
</html>
"""


def _error(message: str, status: int = 404):
    return render_template_string(_ERROR_PAGE, message=message), status


def _best_portal(site_portals: list, ssid: str):
    """Pick the best portal from a site's active portals given an SSID."""
    if not site_portals:
        return None
    ssid_match = next((p for p in site_portals if p.ssids and ssid in p.ssids), None)
    site_wide = next((p for p in site_portals if not p.ssids), None)
    return ssid_match or site_wide or site_portals[0]


# UniFi appends /guest/s/<site_name>/ to the configured IP - match both
# with and without trailing slash.
@dispatch_bp.route("/guest/s/<unifi_site_id>/")
@dispatch_bp.route("/guest/s/<unifi_site_id>")
def portal_dispatch(unifi_site_id: str):
    ssid = (request.args.get("ssid") or "").strip()
    ap_mac = (request.args.get("ap") or "").lower().strip()

    portal = None

    # ── Primary: resolve by site ID from URL path ────────────────────────────
    sites = UnifiSite.query.filter_by(unifi_site_id=unifi_site_id, is_active=True).all()

    if sites:
        site = sites[0]

        # If the same internal site name exists on multiple controllers, use
        # the AP MAC (populated during controller sync) to pick the right one.
        if len(sites) > 1 and ap_mac:
            ap_record = AccessPoint.query.filter_by(mac_address=ap_mac).first()
            if ap_record:
                matched = [s for s in sites if s.id == ap_record.site_id]
                if matched:
                    site = matched[0]

        site_portals = Portal.query.filter_by(site_id=site.id, is_active=True).all()
        portal = _best_portal(site_portals, ssid)

    # ── Fallback: SSID-only search (site not yet synced) ─────────────────────
    # ssids is a JSON list column - not portable to filter at the SQL level, and
    # this path is a rare edge case, so filter in Python over active portals.
    if portal is None and ssid:
        candidates = [
            p for p in Portal.query.filter_by(is_active=True).all()
            if p.ssids and ssid in p.ssids
        ]
        if len(candidates) == 1:
            portal = candidates[0]
        elif len(candidates) > 1:
            logger.warning(
                "Ambiguous portal dispatch: site %r not found, %d portals share SSID %r",
                unifi_site_id, len(candidates), ssid,
            )
            return _error(
                'Multiple portals are configured for this SSID and the site '
                'could not be identified. Please sync your controller.'
            )

    if portal is None:
        logger.warning(
            "No portal found for unifi_site_id=%r ssid=%r ap=%r",
            unifi_site_id, ssid, ap_mac,
        )
        return _error(
            'No active portal is configured for this network. '
            'Check that this site has been synced and has an active portal.'
        )

    # Preserve all UniFi-supplied params when forwarding to the slug route
    return redirect(
        url_for("portal.show_portal", slug=portal.slug, **request.args),
        code=302,
    )
