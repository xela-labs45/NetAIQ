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

- 📡 **Real-time Device Monitoring** — ICMP ping checks with live status and interactive "Live Devices" modal (Wired/Wireless filtering)
- 🏢 **Network Segments** — Organise devices by subnet (CIDR), with automated host discovery scanning and strict validation
- 📊 **UniFi Integration** — Full health oversight including WAN stats, Access Point status, and throughput monitoring
- 🚨 **Bulk Device Management** — Register multiple discovered devices to tracking in a single click
- 📧 **Automated Alerting** — Configurable email alerts (SMTP) for device events and high latency
- 🤖 **AI Insights** — Automated device identification (OUI + AI), 24h anomaly detection, and intelligent alert triage via Anthropic or OpenRouter
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
| **Monitoring** | `ping`, `node-cron`, `p-limit`, `netmask` |
| **Notifications** | Nodemailer (SMTP) |
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
| **Ping Interval** | How often to ping tracked devices (default: 60s) |
| **UniFi Sync Interval** | How often to pull data from UniFi (default: 5 min) |
| **Alert Cooldown** | Minimum time between repeated alerts for the same device (default: 15 min) |

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
- **Device Identification**: Click the "Auto-Identify" button on any unknown device to get a type and manufacturer suggestion.
- **Anomaly Detection**: NetMon analyzes the last 24h of ping logs every 10 minutes to find latency patterns.
- **Alert Triage**: Automatically groups recent alerts into logical patterns with recommended actions.

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
| `GET` | `/unifi/clients` | Get UniFi clients |
| `GET` | `/unifi/wan` | Get WAN throughput and status |
| `GET` | `/unifi/wlan` | Get Access Point health and WiFi throughput |
| `GET` | `/unifi/clients-usage` | Get Top Clients with hostname resolution |
| `GET/PUT` | `/settings` | Read/update application settings |
| `GET` | `/ai/status` | Get current AI configuration and availability |
| `GET` | `/ai/anomalies` | Get latest 24h anomaly analysis |
| `GET` | `/ai/alert-summary` | Get latest 48h alert triage summary |
| `POST` | `/ai/identify-device` | Trigger AI identification for a specific device |
| `GET` | `/ai/models` | Fetch real-time model list from provider |

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

---

<div align="center">

Made with ❤️ for small and medium business network administrators

</div>
