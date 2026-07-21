"""
Unifi API client - supports two controller types:

self_hosted  UniFi Network Application running on-premises or on a console.
             Auth: username/password (auto-detects UniFi OS vs legacy) or API key.

cloud        UniFi Site Manager at api.ui.com (v1 REST API).
             Auth: API key only, generated at unifi.ui.com → Settings → API Keys.
             The cloud API uses different URL paths and a different site-list
             response envelope.  Guest stamgr commands are proxied through
             /ea/sites/{siteId}/cmd/stamgr - same payload as self-hosted.
"""

import requests
import logging
from typing import Optional

logger = logging.getLogger(__name__)

CLOUD_API_BASE = "https://api.ui.com"


class UnifiError(Exception):
    pass


class UnifiClient:
    def __init__(self, controller):
        self._is_cloud = getattr(controller, "controller_type", "self_hosted") == "cloud"
        self._session = requests.Session()

        if self._is_cloud:
            self.base_url = CLOUD_API_BASE
            self._session.headers.update({
                "X-API-Key": controller.api_key,
                "Content-Type": "application/json",
            })
            self._logged_in = True
            self._is_unifi_os = False  # not used for cloud path
        else:
            self.base_url = controller.url.rstrip("/")
            self._session.verify = controller.verify_ssl
            self.auth_mode = getattr(controller, "auth_mode", "password")
            self._logged_in = False
            self._is_unifi_os = False

            if self.auth_mode == "api_key":
                self._session.headers.update({
                    "X-API-Key": controller.api_key,
                    "Content-Type": "application/json",
                })
                self._is_unifi_os = True
                self._logged_in = True
            else:
                self.username = controller.username
                self.password = controller.password

    # ── Self-hosted auth ────────────────────────────────────────────────────

    def _login(self):
        if self.auth_mode == "api_key":
            return

        # Try UniFi OS console endpoint first
        try:
            r = self._session.post(
                f"{self.base_url}/api/auth/login",
                json={"username": self.username, "password": self.password},
                timeout=10,
            )
            if r.status_code == 200:
                self._is_unifi_os = True
                self._logged_in = True
                token = r.json().get("data", {}).get("token") or r.json().get("token")
                if token:
                    self._session.headers["Authorization"] = f"Bearer {token}"
                csrf = r.headers.get("X-CSRF-Token")
                if csrf:
                    self._session.headers["X-CSRF-Token"] = csrf
                return
            if r.status_code == 401:
                body = r.json() if r.content else {}
                if body.get("twoFactorRequired") or body.get("errors", {}).get("totp"):
                    raise UnifiError(
                        "Controller has 2FA enabled. Generate an API key in UniFi OS → "
                        "Settings → Integrations and use API Key auth mode instead."
                    )
        except UnifiError:
            raise
        except requests.RequestException:
            pass

        # Fall back to legacy UniFi Network Server endpoint
        r = self._session.post(
            f"{self.base_url}/api/login",
            json={"username": self.username, "password": self.password},
            timeout=10,
        )
        if r.status_code != 200:
            raise UnifiError(f"Login failed: HTTP {r.status_code} - {r.text[:200]}")
        self._logged_in = True

    def _ensure_login(self):
        if not self._logged_in:
            self._login()

    def _self_hosted_api_url(self, site: str, path: str) -> str:
        if self._is_unifi_os:
            return f"{self.base_url}/proxy/network/api/s/{site}/{path.lstrip('/')}"
        return f"{self.base_url}/api/s/{site}/{path.lstrip('/')}"

    def _get(self, site: str, path: str) -> dict:
        self._ensure_login()
        r = self._session.get(self._self_hosted_api_url(site, path), timeout=15)
        _raise_for_status(r)
        return r.json()

    def _post(self, site: str, path: str, payload: dict) -> dict:
        self._ensure_login()
        r = self._session.post(self._self_hosted_api_url(site, path), json=payload, timeout=15)
        _raise_for_status(r)
        return r.json()

    # ── Public API (normalised across both types) ───────────────────────────

    def get_sites(self) -> list[dict]:
        """Return sites as [{"name": <site_id>, "desc": <display_name>}, ...]."""
        if self._is_cloud:
            r = self._session.get(f"{self.base_url}/ea/sites", timeout=15)
            _raise_for_status(r)
            items = r.json().get("data", [])
            return [
                {"name": item["siteId"], "desc": item.get("meta", {}).get("desc", item["siteId"])}
                for item in items
            ]
        else:
            self._ensure_login()
            if self._is_unifi_os:
                url = f"{self.base_url}/proxy/network/api/self/sites"
            else:
                url = f"{self.base_url}/api/self/sites"
            r = self._session.get(url, timeout=15)
            _raise_for_status(r)
            return r.json().get("data", [])

    def authorize_guest(
        self,
        site_id: str,
        mac: str,
        minutes: int = 60,
        up_kbps: Optional[int] = None,
        down_kbps: Optional[int] = None,
    ) -> dict:
        payload: dict = {"cmd": "authorize-guest", "mac": mac.lower(), "minutes": minutes}
        if up_kbps:
            payload["up"] = up_kbps
        if down_kbps:
            payload["down"] = down_kbps

        if self._is_cloud:
            r = self._session.post(
                f"{self.base_url}/ea/sites/{site_id}/cmd/stamgr",
                json=payload, timeout=15,
            )
            _raise_for_status(r)
            return r.json()
        else:
            return self._post(site_id, "cmd/stamgr", payload)

    def unauthorize_guest(self, site_id: str, mac: str) -> dict:
        payload = {"cmd": "unauthorize-guest", "mac": mac.lower()}
        if self._is_cloud:
            r = self._session.post(
                f"{self.base_url}/ea/sites/{site_id}/cmd/stamgr",
                json=payload, timeout=15,
            )
            _raise_for_status(r)
            return r.json()
        else:
            return self._post(site_id, "cmd/stamgr", payload)

    def get_devices(self, site_id: str) -> list[dict]:
        """Return network devices (APs, switches, etc.) for a site."""
        if self._is_cloud:
            r = self._session.get(
                f"{self.base_url}/ea/devices",
                params={"siteId": site_id},
                timeout=15,
            )
            _raise_for_status(r)
            return r.json().get("data", [])
        else:
            return self._get(site_id, "stat/device").get("data", [])

    def get_active_clients(self, site_id: str) -> list[dict]:
        if self._is_cloud:
            r = self._session.get(
                f"{self.base_url}/ea/clients/active",
                params={"siteId": site_id},
                timeout=15,
            )
            _raise_for_status(r)
            return r.json().get("data", [])
        else:
            return self._get(site_id, "stat/sta").get("data", [])

    def get_wlans(self, site_id: str) -> list[dict]:
        if self._is_cloud:
            # Cloud API does not expose WLAN config in the EA API
            return []
        return self._get(site_id, "rest/wlanconf").get("data", [])

    def get_ssid_names(self, site_id: str) -> list[str]:
        return sorted({w["name"] for w in self.get_wlans(site_id) if w.get("name")})

    def get_guest_ssid_names(self, site_id: str) -> list[str]:
        """SSIDs with UniFi's own "Guest Policy" enabled. Empty on cloud
        controllers (get_wlans returns nothing) or if no WLAN is flagged -
        callers should treat empty as "unknown", not "no guest SSIDs"."""
        return sorted({w["name"] for w in self.get_wlans(site_id) if w.get("name") and w.get("is_guest")})


def _raise_for_status(r: requests.Response):
    if r.status_code >= 400:
        raise UnifiError(f"Unifi API error: HTTP {r.status_code} - {r.text[:300]}")
