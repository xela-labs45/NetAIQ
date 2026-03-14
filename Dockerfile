# Root Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# Install all dependencies fresh
RUN npm install
RUN cd client && npm install
RUN cd server && npm install

# Copy source code (node_modules excluded by .dockerignore)
COPY . .

# Build frontend
RUN cd client && npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app/server ./server
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/client/dist ./server/public
COPY package*.json ./

EXPOSE 3001
CMD ["node", "server/server.js"]
