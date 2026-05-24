#!/bin/bash
# Local development with hot reload and live database

set -e

echo "🚀 Starting SpectraCleanse AI in development mode..."

# Load .env if it exists, otherwise use defaults
if [ -f .env ]; then
  echo "📝 Loading .env"
  export $(grep -v '^#' .env | xargs)
else
  echo "⚠️  .env not found. Using defaults. Copy .env.example to .env for custom settings."
  export JWT_SECRET="dev-secret-$(date +%s)"
  export STRIPE_SECRET_KEY="sk_test_dev"
  export STRIPE_WEBHOOK_SECRET="whsec_dev"
  export STRIPE_CREATOR_PRICE_ID="price_dev_creator"
  export STRIPE_STUDIO_PRICE_ID="price_dev_studio"
  export GEMINI_API_KEY="dev_key"
  export FRONTEND_URL="http://localhost:5173"
  export DB_PATH="/tmp/spectra-dev.db"
  export PORT=3001
  export NODE_ENV=development
fi

echo "🐳 Building and starting containers with compose watch..."
docker compose up --pull=missing --watch --build

echo "✅ Containers started. Backend: http://localhost:3001, Frontend: http://localhost:5173"
