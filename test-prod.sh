#!/bin/bash
# Production-like local test before pushing to main

set -e

echo "🧪 Running production-like test locally..."

# Build the production image
echo "🏗️  Building Docker image..."
docker build -t spectracleanse-api:test .

# Run the container with test env vars
echo "🚀 Running container..."
docker run -d \
  --name spectracleanse-test \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -e PORT=3001 \
  -e JWT_SECRET="test-secret-$(date +%s)" \
  -e STRIPE_SECRET_KEY="sk_test_prod" \
  -e STRIPE_WEBHOOK_SECRET="whsec_test" \
  -e STRIPE_CREATOR_PRICE_ID="price_test_creator" \
  -e STRIPE_STUDIO_PRICE_ID="price_test_studio" \
  -e GEMINI_API_KEY="test_key" \
  -e FRONTEND_URL="http://localhost:3001" \
  -e DB_PATH="/data/spectra.db" \
  -v /tmp/spectra-test:/data \
  spectracleanse-api:test

# Wait for health check
echo "⏳ Waiting for container to be healthy..."
for i in $(seq 1 30); do
  if docker exec spectracleanse-test curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✅ Container is healthy"
    docker stop spectracleanse-test
    docker rm spectracleanse-test
    exit 0
  fi
  sleep 1
done

echo "❌ Container failed to become healthy"
docker logs spectracleanse-test
docker stop spectracleanse-test
docker rm spectracleanse-test
exit 1
