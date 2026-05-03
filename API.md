# API Reference

All endpoints are prefixed with `/api/v1/` and require a valid JWT cookie.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/login` | Log in (rate limited: 10 attempts / 15 min) |
| `POST` | `/auth/logout` | Clear the JWT cookie |
| `GET` | `/devices/online` | Get online devices with optional `?connection=` filter |
| `POST` | `/devices/bulk` | Bulk register discovered devices |
| `POST` | `/devices/:id/ping` | Trigger an immediate ping |
| `GET` | `/devices/:id/history` | Get ping history |
| `GET` | `/devices/:id/uptime` | Get uptime stats |
| `GET/POST/PUT/DELETE` | `/segments` | Manage network segments (validated CIDR) |
| `POST` | `/segments/:id/scan` | Start a subnet scan |
| `GET` | `/alerts` | List alerts |
| `PUT` | `/alerts/:id/read` | Mark alert as read |
| `PUT` | `/alerts/read-all` | Mark all alerts as read |
| `GET` | `/discovered-devices` | List ARP-discovered devices |
| `GET` | `/discovered-devices/:id` | Get a single discovered device |
| `GET` | `/discovery/capability` | Check available discovery tools in the current environment |
| `POST` | `/discovery/arp-scan` | Start ARP scan on the auto-detected L2 segment |
| `GET` | `/discovery/arp-status` | Check if an ARP scan is currently running |
| `GET` | `/discovery/mac-stats` | Get MAC tracking statistics |
| `POST` | `/discovery/mac-stats/reset` | Reset MAC tracking statistics |
| `POST` | `/discovery/harvest-unifi` | Trigger UniFi client harvest |
| `GET` | `/unifi/clients` | Get UniFi clients |
| `GET` | `/unifi/wan` | Get WAN throughput and status |
| `GET` | `/unifi/wlan` | Get Access Point health and WiFi throughput |
| `GET` | `/unifi/clients-usage` | Get top clients with hostname resolution |
| `GET/PUT` | `/settings` | Read/update application settings |
| `GET` | `/settings/telegram` | Get Telegram settings (token masked) |
| `PUT` | `/settings/telegram` | Save Telegram bot token, chat ID, and enabled flag |
| `POST` | `/settings/telegram/test` | Send a test Telegram notification |
| `GET` | `/ai/status` | Get current AI configuration and availability |
| `GET` | `/ai/anomalies` | Get latest 24h anomaly analysis |
| `GET` | `/ai/alert-summary` | Get latest 48h alert triage summary |
| `POST` | `/ai/identify-device` | Trigger AI identification for a specific device |
