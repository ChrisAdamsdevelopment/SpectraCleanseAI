# ─────────────────────────────────────────────────────────────────────────────
# SpectraCleanse AI – Backend Dockerfile
# Base: node:18-alpine  |  Exposes port 3001
# ─────────────────────────────────────────────────────────────────────────────

FROM node:18-alpine

# ExifTool requires Perl, which is not included in Alpine by default
RUN apk add --no-cache perl

# Create a non-root user to run the process
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server.js ./

# Runtime uploads directory (ephemeral; processed files are deleted after download)
# Persistent data directory for SQLite – mount a volume here in production
RUN mkdir -p uploads /data && chown -R appuser:appgroup /app uploads /data

# Drop to non-root for all subsequent instructions and at runtime
USER appuser

EXPOSE 3001

CMD ["node", "server.js"]
