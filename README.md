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

# SITE_ADDRESS: Set to 'localhost' for local SSL, or your domain (e.g. netmon.example.com) for public SSL
SITE_ADDRESS=localhost
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

> [!IMPORTANT]
> The container now runs as a non-root user (**node**, UID 1000). If you have an existing database, you **must** fix the host permissions for the `data/` directory.

```bash
# Fix host permissions
sudo chown -R $USER:$USER data/

# Build and start
sudo docker compose up -d --build
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
This occurs if the `data/netmon.db` file is owned by `root` (likely from a previous run). The container now runs as a non-privileged user (UID 1000).
**Fix:** Run `sudo chown -R $USER:$USER data/` on your host machine to grant the correct permissions.

### Socket connection failed (Unauthorized)
Ensure your `JWT_SECRET` is consistent and that your browser is allowing third-party cookies if accessing the dashboard via a separate domain. The dashboard uses unified JWT verification for both API and real-time updates.

### UniFi Sync not working
Check the **Settings** page to ensure your Controller URL (e.g., `https://192.168.1.1`) and credentials are correct. Use the "Test Connection" button to verify.

---

<div align="center">

Made with ❤️ for small and medium business network administrators

</div>
