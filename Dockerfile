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

WORKDIR /app

# Copy package.json and only install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend from the previous stage
COPY --from=build /app/server ./server

# Set permissions or specific non-root user if needed, but keeping it simple
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
