<div align="center">

# 🖥️ NetMon Dashboard

**A self-hosted SMB network monitoring dashboard with real-time device tracking, alerting, and UniFi integration.**

[![Node.js](https://img.shields.io/badge/Node.js-20-brightgreen?logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://reactjs.org)
[![Fastify](https://img.shields.io/badge/Fastify-4-black?logo=fastify)](https://fastify.dev)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

</div>

---

## ✨ Features

- 📡 **Split-Interval Monitoring** — Independent high-frequency polling for critical devices and periodic full-segment scans (skips critical devices for efficiency)
- ⚡ **Escalating Poll Mode** — Automatically switches to 30s polling when a critical device goes offline to detect fast recovery (capped at 20 attempts)
- 📊 **Live Job Status** — Real-time countdowns and escalation status tracking directly in the Settings UI
- 🏢 **Network Segments** — Organise devices by subnet (CIDR), with automated host discovery scanning and strict validation
- � **MAC OUI Lookup** — 1,100+ device manufacturers recognized instantly (IoT, mobile, gaming, network, servers, cameras)
- � **UniFi Integration** — Full health oversight including WAN stats, Access Point status, and throughput monitoring
- 🚨 **Bulk Device Management** — Register multiple discovered devices to tracking in a single click
- 📧 **Automated Alerting** — Configurable email alerts (SMTP) for device events and high latency
- 📲 **Telegram Notifications** — Real-time bot alerts for critical device offline/online, AP status changes, and segment outages
- 🤖 **AI Insights** — Automated device identification (OUI + AI), 24h anomaly detection, and highly-efficient alert triage via Anthropic or OpenRouter
- 🧹 **Automated Data Maintenance** — Configurable background jobs for ping history and alert data retention to maintain performance
- 🔐 **Hardened Security** — Unified JWT authentication (Socket.IO + API), login rate limiting, atomic scan locking, and hidden production stack traces

---

## 📸 Screenshots

> _Screenshots coming soon after initial deployment_

---

## 🗂️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, Material UI (MUI), TanStack Query, Socket.IO Client |
| **Backend** | Node.js 20, Fastify 4, Socket.IO |
| **Database** | SQLite (`better-sqlite3`) |
| **Auth** | JWT (`@fastify/jwt`), HTTP-only cookies, Rate Limiting |
| **Validation** | `zod` (Strict schema-based input validation) |
| **Monitoring** | `ping`, `setTimeout`-based precise schedulers, `p-limit`, `netmask` |
| **Notifications** | Nodemailer (SMTP), Telegram Bot API |
| **AI Providers** | Anthropic (e.g., Claude 3.5), OpenRouter (e.g., Llama 3, Mistral) |
| **Deployment** | Docker, Docker Compose |

---

## 🚀 Quick Start (Docker)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/netmon-dashboard.git
cd netmon-dashboard
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET` at minimum. UniFi and email settings are configured through the Settings page after first login — no additional environment variables needed.

```env
PORT=3001
NODE_ENV=production
JWT_SECRET=your_strong_random_secret_here
DB_PATH=./data/netmon.db

# SSL / Proxy Settings
SITE_ADDRESS=localhost
HTTP_PORT=3080
HTTPS_PORT=3443
```

### 3. SSL Configuration (Caddy)

By default, NetMon is configured to use **Caddy** as a reverse proxy to provide automatic SSL/HTTPS.

- **For Local Use (HTTPS via Internal CA)**: Keep `SITE_ADDRESS=localhost` or set it to your server's local IP (e.g., `192.168.1.1`). Caddy will use a self-signed certificate.
- **For Public Use (HTTPS via Let's Encrypt)**: Set `SITE_ADDRESS` to your registered domain name. Ensure ports 80 and 443 are open and pointing to your server.

> [!TIP]
> **Remote Local Access**: To access the dashboard from another machine on your network (e.g., `https://192.168.1.1:3443`), ensure `SITE_ADDRESS` in your `.env` is set to that local IP address, then restart with `docker compose down && docker compose up -d`.

> [!TIP]
> If you prefer to manage your own reverse proxy (Nginx, Traefik, etc.), you can disable Caddy in `docker-compose.yml` and uncomment the `ports` section for the `netmon` service.

### 4. Build and run

```bash
docker compose up -d --build
```

### 4. Access the dashboard

Open your browser and navigate to: **[https://localhost:3443](https://localhost:3443)** (or your configured domain/port).

> [!TIP]
> You can customize the ports (e.g., if 3443 is taken) by changing `HTTP_PORT` and `HTTPS_PORT` in your `.env` file.

> [!NOTE]
> If using local-only SSL (`localhost`), your browser will show a certificate warning. You can safely proceed or trust the Caddy Root CA.

**Default login credentials:**
| Field | Value |
|---|---|
| Email | `admin@netmon.local` |
| Password | `Admin@1234` |

> ⚠️ You will be prompted to change your password on first login.

---

## ⚙️ Configuration

All settings can be configured from the **Settings** page in the UI after logging in.

| Setting | Description |
|---|---|
| **UniFi Controller** | URL and credentials for UniFi integration (Managed in UI) |
| **SMTP / Email** | Mail server and recipient settings for alerts (Managed in UI) |
| **Telegram** | Bot token and chat ID for real-time Telegram notifications (Managed in UI) |
| **Critical Ping Interval** | How often to ping devices marked as critical (default: 120s) |
| **Segment Scan Interval** | How often to sweep all subnets for non-critical devices (default: 15m) |
| **UniFi Sync Interval** | How often to pull data from UniFi (default: 5 min) |
| **Alert Cooldown** | Prevents duplicate alerts for a device within this window (default: 15 min) |
| **Ping History Retention** | Days to keep historical ping latency data (default: 90 days) |
| **Alert History Retention** | Days to keep historical alerts (default: 180 days) |

> [!NOTE]
> Database cleanup jobs run automatically in the background. Unresolved critical alerts are protected and never deleted by retention policies.

---

## 📲 Telegram Notifications

📲 Telegram Notifications — Real-time bot alerts for critical device offline/online, AP status changes, and segment outages
- 🤖 **AI-Enhanced Telegram Alerts** — Optionally append AI-generated remediation steps to your Telegram notifications for immediate troubleshooting guidance

### 1. Create a Telegram Bot
1. Open Telegram and search for **@BotFather**.
2. Send `/newbot` and follow the prompts to create a bot.
3. Copy the **Bot Token** (e.g., `123456789:ABCdefGHIjklMNOpqrSTUvwxyz`).

### 2. Get Your Chat ID
1. Send `/start` to your new bot.
2. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser.
3. Find your `chat_id` in the JSON response. For group chats, the ID will be negative.

### 3. Configure in NetMon
1. Navigate to **Settings > Telegram**.
2. Toggle **Enable Telegram Notifications** on.
3. Paste your **Bot Token** and **Chat ID**.
4. Click **Test Notification** to send a test message.
5. **Enable AI-Enhanced Alerts** (Optional): Toggle this on to use your configured AI provider to suggest remediation steps for each alert. Requires a valid API key in AI Settings.
6. Click **Save Settings**.

### 4. Alert Types
Telegram notifications are sent for the following events:

| Event | Trigger | Severity |
|---|---|---|
| **Critical Device Offline** | A device marked as critical fails ping checks | 🔴 Critical |
| **Critical Device Restored** | A critical device that was offline comes back online | 🟢 Recovery |
| **Access Point Offline** | A UniFi AP goes offline | 🔴 Critical |
| **Access Point Restored** | A UniFi AP that was offline comes back online | 🟢 Recovery |
| **Segment Unreachable** | A network segment scan returns 0 devices | 🔴 Critical |

> [!TIP]
> **AI Remediation**: If "AI-Enhanced Alerts" is enabled, NetMon will append a **"🤖 AI Recommended Actions"** section to each Telegram message with 3-4 specific, actionable steps to resolve the issue.

> [!NOTE]
> Telegram alerts fire only on **status changes** (online → offline or offline → online), not on every scan cycle. Telegram failures are non-blocking and will never delay or crash the monitoring system.

---

## 🔍 Scanning Architecture

NetMon uses a split-polling strategy to balance low-latency monitoring for critical infrastructure with broad visibility across multiple subnets.

### 1. Critical Device Polling
- **Scope**: Only devices tagged as "Critical" in the UI.
- **Interval**: Configurable (default 120s).
- **Behavior**: Runs independently of segment scans to ensure high-priority devices are always checked on time.

### 2. Segment Scanning (Subnet Sweeps)
- **Scope**: Every IP within your registered CIDR segments.
- **Exclusion**: Automatically skips Critical devices to prevent redundant pings.
- **Staggering**: If a Critical Poll is running, the Segment Scan will pause or postpone its start to prioritize system resources and network bandwidth.

### 3. Escalating Poll Mode
- **Triggers**: Automatically activates when a Critical device transitions from Online to Offline.
- **Frequency**: Polls only the affected device(s) every **30 seconds**.
- **The "Cap"**: To avoid indefinite flooding, escalation stops after **20 attempts** (~10 minutes). After the cap, the system reverts to the standard Critical Device interval for that device.
- **Visuals**: Active escalations are shown with real-time attempt counts in **Settings > Polling Intervals**.

---

## 🤖 AI Insights Configuration

The AI Insights feature is optional and allows NetMon to automatically identify unknown devices and perform background network analysis.

### 1. Requirements
- An API Key from [Anthropic](https://console.anthropic.com/) or [OpenRouter](https://openrouter.ai/).

### 2. Setup
1. Log in to NetMon and navigate to **Settings > AI Settings**.
2. **Enable AI Insights**: Toggle the switch to ON.
3. **Select Provider**: Choose between Anthropic or OpenRouter.
4. **Enter API Key**: Paste your key and click **Test Connection**.
5. **Configure Model**: Select a model from the dynamic dropdown (e.g., `Claude 3.5 Sonnet`).

### 3. Features
- **Device Identification**: OUI lookup recognizes 1,100+ manufacturers instantly (Sony, Samsung, Apple, Hikvision, Supermicro, and more). Click "Auto-Identify" for AI-powered suggestions on unknown devices.
- **Anomaly Detection**: NetMon analyzes the last 24h of ping logs every 10 minutes to find latency patterns.
- **Alert Triage**: Automatically groups recent alerts into logical patterns with recommended actions. Runs efficiently by saving tokens when no new alerts have occurred.

### 4. Universal Device Discovery
NetMon features a non-hardcoded, dual-source discovery system to find and track network devices:
- **UniFi Harvest**: Connects to your UniFi Controller to harvest active WiFi/Wired clients and up to 4 weeks of historical device data. Works on all platforms.
- **ARP Scanning**: An L2-segment-aware `nmap` ARP scanner. It auto-detects the server's own Local Area Network segment and scans for wired devices using raw sockets, with fallbacks to `ip neigh` and `arp -a`.
  - **Linux / Docker Note**: ARP scanning requires the `NET_RAW` and `NET_ADMIN` capabilities in `docker-compose.yml`. The container runs as the non-root `node` user, but uses `setcap` to grant `nmap` the permissions to send raw ARP packets.
  - **Mac / Windows Docker Desktop**: ARP scanning is not available due to how Docker handles virtualization networking limits on these platforms. Discovery will automatically fall back to relying entirely on the UniFi Harvest.

### 5. MAC Tracking & Deduplication
NetMon tracks discovered devices with intelligent MAC address handling:
- **Normalization**: MACs are stored in a consistent lowercase format with colons
- **Duplicate Prevention**: Duplicate MACs are automatically detected and updated rather than re-inserted
- **IP Change Tracking**: When a device changes IP addresses, NetMon logs the change while maintaining the same device record
- **Multicast/Broadcast Filtering**: Invalid MAC addresses are automatically filtered out
- **Statistics**: Real-time stats track inserted, updated, and ignored devices via `/api/v1/discovery/mac-stats`

> [!IMPORTANT]
> AI identification is rate-limited to 3 calls per device per minute to prevent API overage.

---

## 🗃️ Data Persistence

The SQLite database is stored in the `./data/` directory on your host machine, mapped into the container via a Docker volume. Your data survives container restarts and updates.

```yaml
volumes:
  - ./data:/app/data
```

---

## 🔌 API Reference

All endpoints are prefixed with `/api/v1/` and require authentication (JWT cookie).

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/login` | Log in (Rate limited: 10 attempts / 15 min) |
| `POST` | `/auth/logout` | Clear the JWT cookie |
| `GET` | `/devices/online` | Get unique online devices with `?connection=` filter |
| `POST` | `/devices/bulk` | Bulk register discovered devices |
| `POST` | `/devices/:id/ping` | Trigger an immediate ping |
| `GET` | `/devices/:id/history` | Get ping history |
| `GET` | `/devices/:id/uptime` | Get uptime stats |
| `GET/POST/PUT/DELETE` | `/segments` | Manage segments (Validated CIDR) |
| `POST` | `/segments/:id/scan` | Start a subnet scan (Verified existence) |
| `GET` | `/alerts` | List alerts |
| `PUT` | `/alerts/:id/read` | Mark alert as read |
| `PUT` | `/alerts/read-all` | Mark all alerts as read |
| `GET` | `/discovered-devices` | List discovered devices from ARP scans |
| `GET` | `/discovered-devices/:id` | Get single discovered device details |
| `GET` | `/discovery/capability` | Check which discovery tools are available in the current environment |
| `POST` | `/discovery/arp-scan` | Start ARP scan on the auto-detected L2 segment |
| `GET` | `/discovery/arp-status` | Check if an ARP scan is currently running |
| `GET` | `/discovery/mac-stats` | Get MAC tracking statistics (inserted, updated, ignored, IP changes) |
| `POST` | `/discovery/mac-stats/reset` | Reset MAC tracking statistics |
| `POST` | `/discovery/harvest-unifi` | Trigger UniFi WiFi/Wired and historical client harvest |
| `GET` | `/unifi/clients` | Get UniFi clients |
| `GET` | `/unifi/wan` | Get WAN throughput and status |
| `GET` | `/unifi/wlan` | Get Access Point health and WiFi throughput |
| `GET` | `/unifi/clients-usage` | Get Top Clients with hostname resolution |
| `GET/PUT` | `/settings` | Read/update application settings |
| `GET` | `/settings/telegram` | Get Telegram settings (token masked) |
| `PUT` | `/settings/telegram` | Save Telegram bot token, chat ID, and enabled flag |
| `POST` | `/settings/telegram/test` | Send a test Telegram notification |
| `GET` | `/ai/status` | Get current AI configuration and availability |
| `GET` | `/ai/anomalies` | Get latest 24h anomaly analysis |
| `GET` | `/ai/alert-summary` | Get latest 48h alert triage summary |
| `POST` | `/ai/identify-device` | Trigger AI identification for a specific device |

---

## 🧑‍💻 Local Development

If you want to run the frontend and backend separately for development:

```bash
# Install root dependencies
npm install

# Install frontend dependencies
cd client && npm install && cd ..

# Run both servers concurrently (Vite on :5173, API on :3001)
npm run dev
```

---

## 📁 Project Structure

```
netmon-dashboard/
├── client/                  # React frontend (Vite)
│   └── src/
│       ├── components/      # Reusable UI components
│       ├── hooks/           # useAuth, useSocket
│       └── pages/           # Dashboard, Devices, Segments, Alerts, Settings...
├── server/                  # Fastify backend
│   ├── db/                  # SQLite schema, migrations, seed
│   ├── jobs/                # Cron jobs (ping, UniFi sync)
│   ├── routes/              # API route handlers
│   └── services/            # Business logic (ping, UniFi, scan, alert, email)
├── data/                    # SQLite database (auto-created, persisted)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 🛠️ Troubleshooting

### `SqliteError: attempt to write a readonly database`
This typically occurs if the `data/` directory or the `netmon.db` file has restricted permissions. The container runs as a non-privileged user (UID 1000).

**Fix:** Run the following command on your host machine to ensure the application has the necessary permissions:
```bash
sudo chown -R $USER:$USER data/
```

### Dashboard shows "Unauthorized" or Socket Errors
Ensure your `JWT_SECRET` in `.env` is a long, random string. If you changed it while the app was running, you may need to clear your browser cookies and log in again.

### UniFi Integration Issues
- **Connection Failed:** Verify the Controller URL (use `https://`) and credentials. Use the **Test Connection** button in Settings.
- **Data Not Appearing:** Check the logs (`docker compose logs -f netmon`) for specific API errors.

### AI Insights Issues
- **502 Bad Gateway:** If after updating you see a 502 error, ensure all container dependencies are built correctly with `docker compose up -d --build netmon`.
- **"AI Provider Not Configured":** Ensure you have both enabled the feature AND provided a valid API key in Settings.
- **No Models in Dropdown:** Check your internet connection and verify your API key is active. Use the "Refresh Models" button.

### Telegram Notification Issues
- **Test message fails:** Verify the bot token format (`123456789:ABCdef...`) and ensure the chat ID is numeric. For groups, use a negative number.
- **No notifications received:** Confirm you sent `/start` to the bot first — Telegram bots cannot message users who haven't initiated a conversation.
- **"Telegram alerts are disabled":** Navigate to Settings > Telegram and ensure the toggle is ON and settings are saved.
- **AI Action Steps missing:** Ensure "AI-Enhanced Alerts" is toggled ON and you have a valid, active API key in the **AI Settings** tab. If the AI provider is down or exceeds 10s response time, NetMon will skip the enhancement and send the base alert instead.

---

<div align="center">

Made with ❤️ for small and medium business network administrators

</div>
