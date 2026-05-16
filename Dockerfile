# ─────────────────────────────────────────────────────────────────────────────
# NetAIQ production image
#
# Two stages:
#   1. `build` — installs all deps (incl. dev) and builds the Vite frontend.
#   2. final  — copies just the server + production deps into a minimal
#               Alpine image that runs as the non-root `node` user.
# ─────────────────────────────────────────────────────────────────────────────

# ----- Stage 1: build the frontend -------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Backend deps. `npm ci` honours package-lock.json and fails on drift, which
# `npm install` does not — important for reproducible builds.
#
# Native modules (bcrypt, better-sqlite3) have no musl prebuilt binary and
# must compile from source on Alpine, so the build toolchain is required here
# too. This stage is discarded, so the tools are not removed afterwards.
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && npm ci

# Frontend deps.
COPY client/package*.json ./client/
RUN cd client && npm ci

# Copy sources and build. Vite is configured to emit into server/public.
COPY . .
RUN npm run build

# ----- Stage 2: production runtime -------------------------------------------
FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3001

# Networking tools required for L2 device discovery:
#   nmap     — ARP scan
#   iproute2 — `ip neigh` fallback for the ARP cache
#   net-tools — legacy `arp -a` fallback
#   libcap   — `setcap` so non-root nmap can open raw sockets
#   wget     — used by the docker-compose healthcheck
RUN apk add --no-cache \
    nmap \
    iproute2 \
    net-tools \
    libcap \
    wget

# Grant raw-socket capabilities to the nmap binary only. This avoids running
# the whole container as root and means the Node process itself never holds
# CAP_NET_RAW / CAP_NET_ADMIN — only nmap inherits them when invoked.
RUN setcap cap_net_raw,cap_net_admin+eip /usr/bin/nmap

WORKDIR /app

# Pre-create the data dir so the SQLite file owned by `node` (UID 1000)
# survives a bind-mount from the host.
RUN mkdir -p /app/data && chown -R node:node /app

# Install production deps only. better-sqlite3 has no musl prebuilt and must
# compile from source on Alpine — toolchain is added then removed in the
# same RUN to keep the final image small.
COPY --chown=node:node package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    apk del .build-deps

# Bring in the built server (server/public is the bundled frontend).
COPY --from=build --chown=node:node /app/server ./server

# Drop to UID 1000 — the rest of runtime never touches root.
USER node

EXPOSE 3001

# Liveness probe used by Docker / orchestrators. Fastify returns 200 on `/`
# once the server is accepting connections.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:3001/ || exit 1

CMD ["npm", "start"]
