# API Reference

All endpoints are prefixed with `/api/v1/` and (except for `/auth/login` and
`/auth/logout`) require a valid JWT cookie issued by `/auth/login`.

Accounts flagged with `must_change_password` may only call `/auth/*` and
`/settings/password` until they complete the first-login flow.

## Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/login` | Log in with `{ username, password }` (rate-limited: 10 / 15 min) |
| `POST` | `/auth/logout` | Clear the JWT cookie |
| `GET`  | `/auth/me` | Current user info + security warnings (e.g. weak JWT secret) |

## Devices

| Method | Endpoint | Description |
|---|---|---|
| `GET`    | `/devices` | All registered devices with latest status, segment, AI hints |
| `GET`    | `/devices/online` | Merged online list (UniFi + scans + recent pings) with optional `?connection=wired|wireless` and `?page=&limit=` |
| `GET`    | `/devices/online/count` | Online counts (total / wired / wireless / unifi_seen) |
| `POST`   | `/devices` | Register a single device (zod-validated) |
| `POST`   | `/devices/bulk` | Bulk-register devices from a discovered list |
| `PUT`    | `/devices/:id` | Update a registered device |
| `DELETE` | `/devices/:id` | Remove a registered device |
| `POST`   | `/devices/:id/ping` | Trigger an immediate ping |
| `GET`    | `/devices/:id/history` | Ping history for the last `?hours=` (default 24) |
| `GET`    | `/devices/:id/uptime` | 24h and 7d uptime percentages |

## Segments

| Method | Endpoint | Description |
|---|---|---|
| `GET`    | `/segments` | List segments with scan + online counts |
| `POST`   | `/segments` | Create a segment (CIDR-validated) |
| `PUT`    | `/segments/:id` | Update a segment |
| `DELETE` | `/segments/:id` | Delete a segment |
| `POST`   | `/segments/:id/scan` | Kick off a background ICMP sweep |
| `GET`    | `/segments/:id/scans` | Last 5 scan results |

## Alerts

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/alerts` | Most recent 100 alerts (use `?unread=true` to filter) |
| `GET` | `/alerts/count` | Unread / critical / warning counts |
| `PUT` | `/alerts/:id/read` | Mark a single alert as read |
| `PUT` | `/alerts/read-all` | Mark every alert as read |

## Discovery

| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/discovery/capability` | Available discovery tools, detected L2 segment, UniFi reachability |
| `GET`  | `/discovery/discovered` | Discovered-devices list, supports `segment_id`, `is_wired`, `ai_identified`, `search`, `page`, `limit`, `offset` |
| `GET`  | `/discovery/discovered/stats` | Counts by status / source / segment |
| `POST` | `/discovery/arp-scan` | Start ARP scan on the auto-detected L2 segment |
| `GET`  | `/discovery/arp-status` | `{ running: boolean }` |
| `GET`  | `/discovery/mac-stats` | MAC tracking statistics |
| `POST` | `/discovery/mac-stats/reset` | Reset MAC tracking counters |
| `POST` | `/discovery/harvest-unifi` | Trigger a one-off UniFi client harvest |
| `POST` | `/discovery/identify-all` | Batch AI-identify every unidentified discovered device |

## UniFi

| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/unifi/clients` | Live clients (`stat/sta`) |
| `GET`  | `/unifi/devices` | UniFi devices (`stat/device`) |
| `GET`  | `/unifi/health` | Site health (`stat/health`) |
| `GET`  | `/unifi/wan` | WAN throughput, IP, and status |
| `GET`  | `/unifi/wlan` | WLAN / AP totals and throughput |
| `GET`  | `/unifi/clients-usage` | Top-15 talkers over `?start=&end=` (auto daily/weekly) |
| `POST` | `/unifi/report/daily-user` | Raw daily.user report passthrough |
| `POST` | `/unifi/report/hourly-site` | Raw hourly.site report passthrough |
| `GET`  | `/unifi/debug` | Diagnostic dump — only enabled when `DEBUG=true` |

## Settings

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/settings` | All settings (secrets masked) |
| `GET` | `/settings/table-counts` | Row counts and oldest entries for `ping_history` and `alerts` |
| `GET` | `/settings/polling-status` | Live job status: critical poll, segment scan, escalating polls |
| `PUT` | `/settings/general` | Save general settings (currently `timezone`) |
| `PUT` | `/settings/unifi` | Save UniFi credentials |
| `POST`| `/settings/test-unifi` | Validate UniFi credentials |
| `PUT` | `/settings/email` | Save SMTP settings |
| `POST`| `/settings/test-email` | Send a test email with current/override settings |
| `PUT` | `/settings/ai` | Save AI provider, key, and model |
| `PUT` | `/settings/polling` | Save segment / critical / UniFi intervals |
| `GET` | `/settings/telegram` | Telegram settings (token masked) |
| `PUT` | `/settings/telegram` | Save Telegram bot token, chat ID, event flags, and the two-way bot commands toggle (`telegram_commands_enabled`); restarts inbound bot polling |
| `POST`| `/settings/telegram/test` | Send a test Telegram notification |
| `PUT` | `/settings/password` | Change username + password (rate-limited: 5 / 15 min) |

## AI

| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/ai/status` | Current AI configuration and availability |
| `POST` | `/ai/test-connection` | Validate an AI provider + key (without saving) |
| `GET`  | `/ai/models` | List models for the configured/`?provider=` provider |
| `POST` | `/ai/models/refresh` | Clear the model cache so the next `/models` call refetches |
| `GET`  | `/ai/anomalies` | Latest 24h anomaly analysis (use `?refresh=true` to force) |
| `GET`  | `/ai/alert-summary` | Latest alert triage (use `?refresh=true` to bypass delta tracking) |
| `POST` | `/ai/identify-device` | AI-identify a registered device by `device_id` |
| `POST` | `/ai/identify-mac` | AI-identify a discovered MAC |
| `GET`  | `/ai/unidentified-devices` | Devices missing AI identification |
| `POST` | `/ai/dismiss-noise` | Bulk-mark alerts as read |
| `GET`  | `/ai/history` | Past anomaly / triage runs (`?type=&limit=`) |
| `POST` | `/ai/restart-jobs` | Restart the AI background jobs with the latest interval settings |

## Telegram Bot (inbound)

The two-way Telegram bot is **not exposed as a REST endpoint**. It runs as an
internal long-polling loop (`getUpdates`) started on server boot and restarted by
`PUT /settings/telegram`. It is gated by the bot token, chat ID, and
`telegram_commands_enabled`, and authorises inbound messages against the
configured chat ID only.

Supported chat commands: `/status`, `/online`, `/offline`, `/critical`,
`/alerts`, `/alerts all`, `/aps`, `/segments`, `/markread`, `/help`.

## Errors

API errors are returned as JSON with the shape:

```json
{ "error": true, "message": "Human-readable description" }
```

Production responses redact internal details (DB schema, file paths) via the
shared `safeError()` helper. Set `NODE_ENV=development` to see raw messages
during local development.
