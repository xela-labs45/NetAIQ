# NetAIQ Deployment & Operations Guide

This document is the deep-dive companion to the [README](README.md). It covers
installation paths, configuration, security hardening, backups, upgrades,
common failure modes, and the runtime architecture you may need to debug.

If you only want to spin the app up, the README is enough. Come here when you
need to understand *why* something is configured the way it is, or when
something goes wrong.

---

## 1. System Requirements

| Component | Minimum | Notes |
|---|---|---|
| OS | Linux x86_64 / arm64 | ARP scanning works only on Linux hosts |
| RAM | 512 MB | 1 GB+ recommended once UniFi history is loaded |
| Disk | 1 GB | Database grows with ping history and alert retention |
| CPU | 1 vCPU | Two cores recommended for parallel segment scans |
| Docker | 24.x or newer | Compose v2 (`docker compose`, not `docker-compose`) |
| Network | Host networking | Required for L2 ARP discovery |

ARP discovery on **macOS / Windows Docker Desktop** is not supported because
the container runs inside a Linux VM whose bridge is not on your LAN. The
app falls back to UniFi-based discovery on those hosts.

---

## 2. Deployment Paths

### 2.1 Plain HTTP (LAN / home lab) — default

```bash
cp .env.example .env
# edit .env and set JWT_SECRET
docker compose up -d --build
```

The app binds `PORT` on the host (default `3001`). No TLS, no reverse proxy.
Use this only on trusted networks.

### 2.2 HTTPS with Caddy + Let's Encrypt (public domain)

1. Point a DNS A/AAAA record at the server.
2. Open ports **80** and **443** to the host (Let's Encrypt's HTTP-01
   challenge needs port 80).
3. In `.env`:

   ```env
   SITE_ADDRESS=netaiq.example.com
   HTTP_PORT=80
   HTTPS_PORT=443
   ```

4. Start the overlay:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
   ```

Caddy issues + renews the cert automatically. The overlay also sets
`COOKIE_SECURE=true` for you. Certificates live in the named `caddy_data`
Docker volume — back it up if you don't want to re-issue on rebuild.

### 2.3 HTTPS with Caddy + self-signed (LAN HTTPS)

Same overlay, but set `SITE_ADDRESS=192.168.x.y` (or `localhost`). Caddy will
issue a cert from its internal CA. To remove browser warnings, install the
root CA on each client — instructions are in the README "Option A" block.

### 2.4 Bring-your-own reverse proxy (Nginx / Traefik / HAProxy)

Run only the base stack and proxy HTTPS traffic to `http://<host>:3001`.
Set `COOKIE_SECURE=true` in `.env` so auth cookies are marked secure. The app
honours `X-Forwarded-For` / `X-Forwarded-Proto` (`trustProxy: true`) so the
rate limiter and login logs see the real client IP.

> Do **not** set `COOKIE_SECURE=true` when serving over plain HTTP — browsers
> drop secure cookies on HTTP and logins will silently fail.

---

## 3. Configuration

### 3.1 Environment variables (`.env`)

Only boot-time values live in `.env`. Everything else (UniFi creds, SMTP,
Telegram, AI provider, polling intervals, retention) is configured in the
Settings page and persisted in the SQLite DB.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | yes | `3001` | Port the Fastify app binds |
| `NODE_ENV` | yes | `production` | Disables CORS for non-same-origin clients and hides stack traces |
| `JWT_SECRET` | yes | — | HMAC secret for auth + cookie signing. **Must** be ≥32 chars and unique per deployment |
| `DB_PATH` | yes | `./data/netaiq.db` | SQLite file path (the directory is auto-created) |
| `COOKIE_SECURE` | no | `false` | Set `true` when serving over HTTPS so cookies are flagged secure |
| `SITE_ADDRESS` | no | `localhost` | Hostname / IP used by the Caddy overlay |
| `HTTP_PORT` | no | `3080` | Caddy HTTP port (set to `80` for Let's Encrypt) |
| `HTTPS_PORT` | no | `3443` | Caddy HTTPS port (set to `443` for production) |
| `DEBUG` | no | unset | Enables verbose UniFi response logging and `/unifi/debug` |

If `JWT_SECRET` is missing the server refuses to start. If it's weak or still
the placeholder, the server boots but prints a security warning and surfaces
a `WEAK_JWT_SECRET` warning to authenticated users via `/auth/me`.

### 3.2 UI-managed settings

The Settings page writes to the `settings` SQLite table. Reading/writing
secrets (UniFi password, SMTP password, Telegram bot token, AI keys) goes
through a masking layer (`••••••••`) so values never leave the server after
the first save unless you explicitly type a new one.

---

## 4. First-Login Flow

1. Default credentials are `admin` / `Admin@1234`.
2. On first login the user is forced into the change-password screen.
3. They must choose a new **username** (3–31 chars, `[a-zA-Z0-9_-]`) and a
   password of at least **12 characters**.
4. Until both are set the JWT carries a `mustChange` flag and all non-auth
   API calls are blocked.

If you forget the admin password, the recovery path is to stop the container,
restore an older DB snapshot, or manually update `users.password_hash` (use
`bcrypt.hash(password, 12)` — the schema has `must_change_password INTEGER`
which you can reset to `1` to force a re-setup).

---

## 5. Backups & Restore

NetAIQ stores everything in **one SQLite file** plus its WAL/SHM siblings.
A complete backup is:

```bash
# host
docker compose stop
cp -a data/ /backup/netaiq-data-$(date +%F)
docker compose start
```

Or with the container running (snapshot via SQLite's online backup API):

```bash
docker compose exec netaiq sh -c \
  'sqlite3 /app/data/netaiq.db ".backup /app/data/netaiq.backup.db"'
docker compose cp netaiq:/app/data/netaiq.backup.db ./netaiq-$(date +%F).db
```

Restore is a file copy. If you use the Caddy overlay and care about reusing
issued certs, also back up the `caddy_data` and `caddy_config` named volumes.

The OUI database (`server/data/oui-ieee.json`) is **not** in `data/`. It's
rebuilt automatically the first time the server starts, or via
`npm run update-oui`. There's no reason to back it up.

---

## 6. Upgrading

```bash
git pull
docker compose down
docker compose up -d --build
```

Schema migrations are idempotent and run automatically on boot — see
`server/db/database.js`. Each `ALTER TABLE` is wrapped in a try/catch that
swallows `duplicate column name` errors, so re-running an upgrade is safe.

Always take a DB backup *before* pulling a major release.

---

## 7. Background Jobs

| Job | Cadence | Notes |
|---|---|---|
| Critical ping | `critical_ping_interval` (default 120s) | Skips devices currently in escalating mode |
| Segment scan | `segment_scan_interval` (default 15 min) | Holds for up to 60s while critical ping is mid-cycle |
| Escalating poll | 30s × up to 20 attempts | Auto-starts when a critical device transitions offline |
| UniFi sync | `unifi_interval_ms` (default 5 min) | Harvests clients, devices, WAN/WLAN health |
| AI anomaly detection | `ai_anomaly_interval` minutes (default 10) | Schedule honours `ai_anomaly_schedule` (always / business_hours / disabled) |
| AI alert triage | `ai_triage_interval` minutes (default 5) | Skipped when unread alert count hasn't changed since last run |
| OUI auto-identify | 5 min | Pure local OUI lookup — no AI calls |
| Ping history cleanup | Daily @ 02:00 | Keeps `ping_history_retention_days` of history (default 90) |
| Alert history cleanup | Weekly Sun @ 03:00 | Keeps `alert_retention_days` (default 180); unresolved criticals are never deleted |

`POST /api/v1/settings/polling` and `POST /api/v1/ai/restart-jobs` re-arm
the relevant timers so interval changes take effect immediately without a
container restart.

---

## 8. Security Hardening

The application ships with these defaults — review them for your environment:

- **JWT in HTTP-only cookies** (`SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`).
- **bcrypt** with 12 rounds for password hashing.
- **Account lockout** after 5 failed logins, for 15 minutes (durable across restarts).
- **IP rate limit** on `/auth/login` (10 / 15 min) and `/settings/password` (5 / 15 min).
- **Atomic scan lock** in the `settings` table prevents concurrent ARP scans.
- **Strict input validation** via `zod` (devices, segments) and per-route regex
  (Telegram tokens, MAC addresses, CIDRs).
- **Helmet** sets sensible HTTP security headers; Caddy adds HSTS,
  X-Frame-Options, Referrer-Policy, and Permissions-Policy on top.
- **`safeError()`** redacts internal error messages in production responses.
- **Capability-scoped privileges**: only the `nmap` binary holds `NET_RAW`
  / `NET_ADMIN`. The Node process runs as the unprivileged `node` user
  (UID 1000) with `no-new-privileges`.
- **CORS disabled in production** — the frontend is served from the same
  origin as the API, so cross-origin requests are unnecessary and refused.

If you expose NetAIQ to the public internet:

1. Use Option B (Caddy + Let's Encrypt) or Option C (BYO HTTPS proxy).
2. Verify `JWT_SECRET` is at least 64 random hex chars (`openssl rand -hex 64`).
3. Set `COOKIE_SECURE=true`.
4. Lock down ports — only 80/443 should be reachable, never 3001 directly.
5. Consider restricting the admin UI to a VPN or Tailscale and only exposing
   the API surface you actually need.

---

## 9. Logging & Observability

- Fastify logs to stdout in JSON. Use `docker compose logs -f netaiq` to
  follow them, or `docker compose logs netaiq | jq` for structured output.
- The Caddy container logs HTTP access lines via
  `docker compose logs -f caddy`.
- `GET /api/v1/settings/polling-status` returns the live state of all
  scheduled jobs including any in-flight escalating polls.
- `GET /api/v1/discovery/capability` reports what discovery tools are
  available in the current container.

For longer retention, point Docker's logging driver at `journald`,
`fluentd`, or an external collector — see the
[Docker logging docs](https://docs.docker.com/config/containers/logging/configure/).

---

## 10. Troubleshooting

### "JWT_SECRET in your .env file is weak" warning on startup
Run `openssl rand -hex 64` and paste the result into `JWT_SECRET`. Restart.

### Login keeps failing with "Invalid credentials" after correct password
The account is probably locked. Check the log line `Account temporarily
locked`. Wait 15 minutes, or clear `failed_attempts` / `locked_until` in the
`users` table.

### Logins succeed in dev but fail behind HTTPS
You probably set `COOKIE_SECURE=true` while still serving over plain HTTP.
Either remove that env var or move to HTTPS.

### "ARP scan not available in this environment"
Either the container can't see your LAN (running on Docker Desktop for
macOS/Windows) or `NET_RAW` is missing. Verify with
`GET /api/v1/discovery/capability` — `platform_note` explains the reason.

### Segment scan never finishes
Look for a stuck `scan_running` row in the `settings` table. The boot
sequence in `server/db/database.js` deletes stale locks on startup, so
restarting the container clears it.

### UniFi connection works in "Test" but data never arrives
Check `unifi_ssl_verify`. Many self-hosted UDM Pros use self-signed certs,
so set it to `false` (or fully off in the UI). Then run
`POST /api/v1/discovery/harvest-unifi` and watch the logs.

### High latency alerts spam the inbox
Tune `alert_cooldown_minutes` (default 15) and disable `alert_on_high_latency`
if you don't want them. High-latency threshold is hard-coded at 200 ms in
`server/services/pingService.js` if you need to adjust it.

### AI panel says "not_configured" / "missing_key"
Settings → AI Settings → pick a provider, paste a key, click **Test
Connection**. The server caches the key in the DB after a successful test.

---

## 11. Architecture (at a glance)

```
+-------------------+    HTTPS    +-----------+   HTTP   +----------------+
|   Browser / UI    | <---------> |   Caddy   | <------> |  Fastify (API) |
+-------------------+             +-----------+          +----------------+
        ^                                                     |    |
        | Socket.IO                                           |    |
        +-----------------------------------------------------+    |
                                                                   v
                                                       +----------------------+
                                                       |   SQLite (WAL mode)  |
                                                       +----------------------+
                                                                   |
                                          +------------------------+------------------+
                                          |                                           |
                                  +-----------------+                       +-------------------+
                                  | Background jobs |                       |   External APIs   |
                                  | ping / scan /   |                       | UniFi / SMTP /    |
                                  | UniFi / AI /    |                       | Telegram /        |
                                  | cleanup         |                       | Anthropic / OR    |
                                  +-----------------+                       +-------------------+
```

The Caddy box is optional — without it the browser talks straight to
Fastify over `:3001`. Background jobs share the same Node process and the
same SQLite connection, which is why they're cooperatively serialised
(`scan_running` lock, `isExecuting` flags, `EscalatingPollManager` map) to
avoid stepping on each other.

---

## 12. Uninstalling

```bash
docker compose down -v        # stops the stack and removes named volumes
rm -rf data/                  # removes the SQLite database (irreversible)
```

`docker compose down -v` deletes the Caddy ACME data — your next install
will request fresh Let's Encrypt certificates, so be mindful of the
[ACME rate limits](https://letsencrypt.org/docs/rate-limits/) if you bounce
the stack repeatedly.
