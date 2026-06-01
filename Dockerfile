# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# SpectraCleanse AI – Production Dockerfile (builds frontend + backend runtime)
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# exiftool-vendored requires Perl at runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends perl \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system appgroup && useradd --system --gid appgroup appuser

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY server.js ./
COPY server ./server
COPY --from=builder /app/dist ./dist

# Runtime directories (uploads ephemeral; /data intended for SQLite volume mounts)
RUN mkdir -p /app/uploads /data \
  && chown -R appuser:appgroup /app /data

USER appuser

EXPOSE 3001
CMD ["npm", "start"]
