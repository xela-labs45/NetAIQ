<div align="center">

# NetAIQ Dashboard

**A self-hosted AI-powered SMB network monitoring dashboard with real-time device tracking, alerting, and UniFi integration.**

[![Node.js](https://img.shields.io/badge/Node.js-20-brightgreen?logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://reactjs.org)
[![Fastify](https://img.shields.io/badge/Fastify-4-black?logo=fastify)](https://fastify.dev)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

</div>

---

## ✨ Features

- 📡 **Split-Interval Monitoring** — Independent high-frequency polling for critical devices and periodic full-segment scans
- ⚡ **Escalating Poll Mode** — Switches to 30s polling when a critical device goes offline, capped at 20 attempts
- 📊 **Live Job Status** — Real-time countdowns and escalation status visible in the Settings UI
- 🏢 **Network Segments** — Organise devices by subnet (CIDR) with automated host discovery and strict validation
- 🔍 **MAC OUI Lookup** — 1,100+ device manufacturers identified instantly (IoT, mobile, gaming, network, servers, cameras)
- 🌐 **UniFi Integration** — Full health oversight including WAN stats, Access Point status, and throughput monitoring
- 🚨 **Bulk Device Management** — Register multiple discovered devices in a single click
- 📧 **Automated Alerting** — Configurable email alerts (SMTP) for device events and high latency
- 📲 **Telegram Notifications** — Real-time bot alerts for critical device offline/online, AP status changes, and segment outages
- 🤖 **AI Insights** — Automated device identification (OUI + AI), 24h anomaly detection, and alert triage via Anthropic or OpenRouter
- 🧹 **Automated Data Maintenance** — Configurable background jobs for ping history and alert data retention
- 🔐 **Hardened Security** — Unified JWT authentication (Socket.IO + API), login rate limiting, atomic scan locking, and hidden production stack traces

---

## 🗂️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, Material UI (MUI), TanStack Query, Socket.IO Client |
| **Backend** | Node.js 20, Fastify 4, Socket.IO |
| **Database** | SQLite (`better-sqlite3`) |
| **Auth** | JWT (`@fastify/jwt`), HTTP-only cookies, rate limiting |
| **Validation** | `zod` — strict schema-based input validation |
| **Monitoring** | `ping`, `setTimeout`-based schedulers, `p-limit`, `netmask` |
| **Notifications** | Nodemailer (SMTP), Telegram Bot API |
| **AI Providers** | Anthropic (Claude 3.5), OpenRouter (Llama 3, Mistral) |
| **Deployment** | Docker, Docker Compose |

---

## 🚀 Quick Start (Docker)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/netaiq-dashboard.git
cd netaiq-dashboard
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET`. UniFi, email, and notification settings are configured through the Settings page after first login.

```env
PORT=3001
NODE_ENV=production
JWT_SECRET=your_strong_random_secret_here
DB_PATH=./data/netaiq.db

# SSL / Proxy Settings
SITE_ADDRESS=localhost
HTTP_PORT=3080
HTTPS_PORT=3443
```

### 3. SSL Configuration (Caddy)

NetAIQ uses **Caddy** as a reverse proxy for automatic SSL/HTTPS.

- **Local use**: Keep `SITE_ADDRESS=localhost` or set it to your server's LAN IP. Caddy issues a self-signed certificate.
- **Public use**: Set `SITE_ADDRESS` to your domain. Ensure ports 80 and 443 point to your server for Let's Encrypt.

> [!TIP]
> To access the dashboard from another machine on your network, set `SITE_ADDRESS` to your server's LAN IP (e.g., `192.168.1.1`) and restart with `docker compose down && docker compose up -d`.

> [!TIP]
> To use your own reverse proxy (Nginx, Traefik, etc.), disable the Caddy service in `docker-compose.yml` and uncomment the `ports` section for the `netaiq` service.

### 4. Build and run

```bash
docker compose up -d --build
```

### 5. Access the dashboard

Navigate to **[https://localhost:3443](https://localhost:3443)** (or your configured domain/port).

> [!NOTE]
> With local SSL, your browser will show a certificate warning. You can safely proceed or trust the Caddy Root CA.

**Default credentials:**

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `Admin@1234` |

> [!WARNING]
> On first login you will be prompted to choose a unique username and set a new password before accessing the dashboard.

---

## ⚙️ Configuration

All settings are managed from the **Settings** page in the UI after logging in.

| Setting | Description |
|---|---|
| **UniFi Controller** | URL and credentials for UniFi integration |
| **SMTP / Email** | Mail server and recipient settings for alerts |
| **Telegram** | Bot token and chat ID for real-time notifications |
| **Critical Ping Interval** | How often to ping critical devices (default: 120s) |
| **Segment Scan Interval** | How often to sweep all subnets (default: 15 min) |
| **UniFi Sync Interval** | How often to pull data from UniFi (default: 5 min) |
| **Alert Cooldown** | Minimum time between duplicate alerts per device (default: 15 min) |
| **Ping History Retention** | Days to retain latency history (default: 90 days) |
| **Alert History Retention** | Days to retain alert history (default: 180 days) |

> [!NOTE]
> Cleanup jobs run automatically in the background. Unresolved critical alerts are never deleted by retention policies.

---

## 📲 Telegram Notifications

### 1. Create a Telegram Bot
1. Open Telegram and message **@BotFather**.
2. Send `/newbot` and follow the prompts.
3. Copy the **Bot Token** (e.g., `123456789:ABCdefGHIjklMNOpqrSTUvwxyz`).

### 2. Get Your Chat ID
1. Send `/start` to your new bot.
2. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser.
3. Find `chat_id` in the JSON response. Group chat IDs are negative numbers.

### 3. Configure in NetAIQ
1. Navigate to **Settings > Telegram**.
2. Toggle **Enable Telegram Notifications** on.
3. Paste your **Bot Token** and **Chat ID**.
4. Click **Test Notification** to verify.
5. Under **Alert Event Selection**, choose which event types trigger a notification. All events are enabled by default — uncheck any you want to suppress.
6. Optionally enable **AI-Enhanced Alerts** to append AI-generated remediation steps to each notification. Requires a valid API key in AI Settings.
7. Click **Save Settings**.

### 4. Supported Events

Each event type is individually toggleable. All are enabled by default.

| Category | Event | Trigger | Severity |
|---|---|---|---|
| **Device** | Critical Device Offline | A critical device fails ping checks | 🔴 Critical |
| **Device** | Critical Device Restored | A critical device comes back online | 🟢 Recovery |
| **Access Point** | Access Point Offline | A UniFi AP goes offline | 🔴 Critical |
| **Access Point** | Access Point Restored | A UniFi AP comes back online | 🟢 Recovery |
| **Segment** | Segment Unreachable | A segment scan returns 0 devices | 🔴 Critical |

> [!NOTE]
> Alerts fire only on **status changes**, not every scan cycle. Telegram failures are non-blocking and will never delay or crash the monitoring system.

---

## 🔍 Scanning Architecture

NetAIQ uses a split-polling strategy to balance low-latency monitoring for critical infrastructure with broad visibility across multiple subnets.

### Critical Device Polling
- **Scope**: Devices tagged as "Critical" in the UI
- **Interval**: Configurable (default: 120s)
- **Behavior**: Runs independently of segment scans

### Segment Scanning
- **Scope**: Every IP within registered CIDR segments
- **Exclusion**: Critical devices are skipped to prevent redundant pings
- **Staggering**: Pauses if a Critical Poll is running to prioritise resources

### Escalating Poll Mode
- **Trigger**: Activates when a Critical device transitions from Online to Offline
- **Frequency**: 30-second polls on the affected device(s)
- **Cap**: Stops after 20 attempts (~10 minutes), then reverts to the standard Critical interval
- **Visibility**: Active escalations show real-time attempt counts in **Settings > Polling Intervals**

---

## 🤖 AI Insights

### Requirements
An API key from [Anthropic](https://console.anthropic.com/) or [OpenRouter](https://openrouter.ai/).

### Setup
1. Navigate to **Settings > AI Settings**.
2. Toggle **Enable AI Insights** on.
3. Select your **Provider** (Anthropic or OpenRouter).
4. Enter your **API Key** and click **Test Connection**.
5. Select a **Model** from the dropdown (e.g., `Claude 3.5 Sonnet`).

### Features
- **Device Identification**: OUI lookup covers 1,100+ manufacturers. Use "Auto-Identify" for AI-powered suggestions on unrecognised devices.
- **Anomaly Detection**: Analyses the last 24h of ping logs every 10 minutes for latency patterns.
- **Alert Triage**: Groups recent alerts into logical patterns with recommended actions. Token-efficient — skips analysis when no new alerts have occurred.

### Device Discovery
NetAIQ uses a dual-source discovery system:

- **UniFi Harvest**: Pulls active WiFi/Wired clients and up to 4 weeks of historical device data from your UniFi Controller.
- **ARP Scanning**: An L2-segment-aware `nmap` ARP scanner. Auto-detects the server's LAN segment and scans for wired devices using raw sockets, with fallbacks to `ip neigh` and `arp -a`.

> [!NOTE]
> ARP scanning on Linux/Docker requires `NET_RAW` and `NET_ADMIN` capabilities (set in `docker-compose.yml`). On Mac/Windows Docker Desktop, ARP scanning is unavailable due to virtualisation networking limits — discovery falls back to UniFi Harvest only.

### MAC Tracking
- MACs are normalised to lowercase colon-separated format
- Duplicates are detected and updated rather than re-inserted
- IP address changes are logged while maintaining the same device record
- Multicast/broadcast MACs are automatically filtered

> [!IMPORTANT]
> AI identification is rate-limited to 3 calls per device per minute.

---

## 🧑‍💻 Local Development

```bash
# Install all dependencies
npm install
cd client && npm install && cd ..

# Run frontend (Vite :5173) and backend (:3001) concurrently
npm run dev
```

---

## 📁 Project Structure

```
netaiq-dashboard/
├── client/                  # React frontend (Vite)
│   └── src/
│       ├── components/      # Reusable UI components
│       ├── hooks/           # useAuth, useSocket
│       └── pages/           # Dashboard, Devices, Segments, Alerts, Settings
├── server/                  # Fastify backend
│   ├── db/                  # SQLite schema, migrations, seed
│   ├── jobs/                # Background jobs (ping, UniFi sync)
│   ├── routes/              # API route handlers
│   └── services/            # Business logic (ping, UniFi, scan, alert, email)
├── data/                    # SQLite database (auto-created, persisted via volume)
├── netaiq-brand/            # Brand assets (SVG/PNG source files)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## ☕ Support the Project

NetAIQ is free and open-source. If it saves you time or helps keep your network reliable, consider buying me a coffee — it goes directly toward continued development, bug fixes, and new features.

| Platform | Link |
|---|---|
| **Ko-fi** | [ko-fi.com/xela_labs](https://ko-fi.com/xela_labs) |
| **PayPal** | [paypal.me/WebDevByElectric](https://paypal.me/WebDevByElectric) |

No pressure — a GitHub star or sharing the project is just as appreciated. 🙏

---

<div align="center">

Made with ❤️ for small and medium business network administrators

</div>
