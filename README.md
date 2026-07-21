<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/branding/readme-banner-dark.png">
  <img src="assets/branding/readme-banner-light.png" alt="Atrium - multi-tenant captive portal">
</picture>

Atrium is an admin panel for running guest WiFi captive portals across
multiple tenants and sites on a UniFi network. It manages the portal-facing
side of the experience (branded login pages, guest sessions, vouchers) and
the operational side (controllers, sites, users, auditing) from one place.

**[Website & screenshots](https://agent-squirrel.github.io/Atrium/)** - a friendlier overview than this README, with a walkthrough of the admin panel.

## Features

- Multi-tenant: separate tenants, sites, and portals under one install
- Portal builder with per-portal branding, customization, and a post-connect page
- Guest session management: active devices, manual authorize/reconnect/deauthorize, vouchers
- Guest analytics per portal
- Role-based access control with two-factor authentication
- Full audit log of admin actions
- Light/dark mode
- Encrypted full-site backup and restore (settings, content, and uploads)

## Quick start (Docker Compose)

Requires Docker and Docker Compose.

1. Clone the repo:

   ```sh
   git clone https://github.com/agent-squirrel/Atrium.git
   cd Atrium
   ```

2. Create your environment file and fill in the required values:

   ```sh
   cp backend/.env.example backend/.env
   ```

   `backend/.env` needs, at minimum, a `SECRET_KEY`, `JWT_SECRET_KEY`,
   `POSTGRES_PASSWORD`, and `ENCRYPTION_KEY` - the file has generation
   commands for each right above the line to fill in. If Atrium will sit
   behind another reverse proxy (Caddy, Traefik, a cloud load balancer)
   rather than facing the internet directly, also set `TRUSTED_PROXY_CIDR`
   to that proxy's address so guest IPs are logged correctly.

3. Start the stack using the published images:

   ```sh
   docker compose up -d
   ```

4. Open `http://localhost/admin/` and follow the first-run setup wizard to
   create your superadmin account (or restore from an existing Atrium
   backup, if you have one).

Building on Atrium or working from source instead of the published images?
See [DEVELOPMENT.md](DEVELOPMENT.md).
