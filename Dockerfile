# ─────────────────────────────────────────────────────────────────────────────
# SpectraCleanse AI – Backend Dockerfile
# Base: node:16-alpine  |  Exposes port 3001
# ─────────────────────────────────────────────────────────────────────────────

FROM node:16-alpine

# ExifTool requires Perl, which is not included in Alpine by default
RUN apk add --no-cache perl

WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server.js ./

# Runtime uploads directory (ephemeral; processed files are deleted after download)
RUN mkdir -p uploads

# Persistent data directory for SQLite – mount a volume here in production
RUN mkdir -p /data

EXPOSE 3001

CMD ["node", "server.js"]
