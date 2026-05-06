#!/bin/bash

set -e

echo "🚀 Starting Claude Monitor Proxy (Docker)"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "⚠️  .env file not found. Creating from .env.example..."
  cp .env.example .env
  echo "✅ Created .env — please update with your Cloudflare Worker details"
  exit 1
fi

# Create log directory if not exists
mkdir -p log

# Build and start
echo "📦 Building Docker image..."
docker-compose build

echo "🚀 Starting mitmproxy container..."
docker-compose up -d

echo ""
echo "✅ Claude Monitor Proxy is running!"
echo ""
echo "📍 Proxy address: http://$(hostname -I | awk '{print $1}'):8080"
echo "📋 View logs: docker logs -f claude-monitor-proxy"
echo "🛑 Stop: docker-compose down"
echo ""
echo "📖 Next: Read DOCKER_SETUP.md for CA certificate setup on clients"
