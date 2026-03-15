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
# By default Vite outputs to dist, let's just make it output to server/public
RUN npm run build

# Production image
FROM node:20-alpine

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Create non-root user and prepare data directory
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/data && \
    chown -R nodejs:nodejs /app

# Copy package.json and only install production dependencies
COPY --chown=nodejs:nodejs package*.json ./
RUN npm install --omit=dev

# Copy built files from the build stage
COPY --from=build --chown=nodejs:nodejs /app/server ./server

# Switch to non-root user
USER nodejs

EXPOSE 3001

CMD ["npm", "start"]
