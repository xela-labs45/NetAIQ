# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine AS build

WORKDIR /app

# Copy root package.json
COPY package*.json ./

# Install backend dependencies
RUN npm install

# Copy client package.json and install frontend dependencies
COPY client/package*.json ./client/
RUN cd client && npm install

# Copy all source files
COPY . .

# Build the frontend (outputs to client/dist, which we'll configure Vite to output directly to server/public or we copy it)
# By default Vite outputs to dist, let's make it output to server/public
RUN npm run build

# Production image
FROM node:20-alpine

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Networking tools for MAC discovery
# nmap:     ARP scan for L2 device discovery
# iproute2: ip neigh fallback ARP cache reader
# net-tools: arp -a legacy fallback
# libcap:   setcap to grant nmap raw socket capability without root
RUN apk add --no-cache \
    nmap \
    iproute2 \
    net-tools \
    libcap

# Grant nmap the raw socket capabilities it needs so the
# non-root 'node' user can perform ARP scans.
# This avoids running the entire container as root.
RUN setcap cap_net_raw,cap_net_admin+eip /usr/bin/nmap

WORKDIR /app

# Ensure data directory exists and is owned by the node user (UID 1000)
RUN mkdir -p /app/data && chown -R node:node /app

# Copy package.json and only install production dependencies.
# better-sqlite3 has no musl prebuilt, so it must compile from source on Alpine.
# Build tools are installed then pruned in a single layer to keep image size down.
COPY --chown=node:node package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm install --omit=dev && \
    apk del python3 make g++

# Copy built files from the build stage
COPY --from=build --chown=node:node /app/server ./server

# Switch to the standard non-root user (UID 1000)
USER node

EXPOSE 3001

CMD ["npm", "start"]
