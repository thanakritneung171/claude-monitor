#!/bin/bash
# Claude Monitor Client Setup (macOS)

CERT_FILE="${1:-mitmproxy-ca.pem}"
PROXY_SERVER="${2:-http://localhost:8080}"

echo "Claude Monitor Client Setup (macOS)"
echo ""

# Step 1: Verify certificate
if [ ! -f "$CERT_FILE" ]; then
    echo "ERROR: Certificate file not found: $CERT_FILE"
    echo "Get it from server:"
    echo "  docker exec claude-monitor-proxy cat /root/.mitmproxy/mitmproxy-ca.pem > mitmproxy-ca.pem"
    exit 1
fi

echo "Step 1: Installing CA Certificate"
echo "You may be prompted for your password..."
echo ""

sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_FILE"
if [ $? -eq 0 ]; then
    echo "✅ SUCCESS: Certificate installed"
else
    echo "❌ ERROR: Failed to install certificate"
    exit 1
fi

echo ""
echo "Step 2: Setting Proxy Environment Variables"

PROXY_HOST=$(echo "$PROXY_SERVER" | sed 's|^https*://||')
echo "Proxy: $PROXY_HOST"

SHELL_CONFIG="$HOME/.zshrc"
if [ ! -f "$SHELL_CONFIG" ]; then
    SHELL_CONFIG="$HOME/.bashrc"
fi

echo "export HTTP_PROXY=http://$PROXY_HOST" >> "$SHELL_CONFIG"
echo "export HTTPS_PROXY=http://$PROXY_HOST" >> "$SHELL_CONFIG"
echo "export ALL_PROXY=http://$PROXY_HOST" >> "$SHELL_CONFIG"

echo "✅ SUCCESS: Environment variables added to $SHELL_CONFIG"

echo ""
echo "Step 3: Activate"
source "$SHELL_CONFIG"
echo "HTTP_PROXY=$HTTP_PROXY"
echo "HTTPS_PROXY=$HTTPS_PROXY"

echo ""
echo "Step 4: Restart Applications"
echo "Close and restart:"
echo "  - Claude Desktop"
echo "  - Claude Code CLI/VSCode"
echo "  - Any other Claude clients"

echo ""
echo "Step 5: Test"
echo "Run: curl -v https://api.anthropic.com"
echo "(Should NOT show certificate warnings)"

echo ""
echo "✅ DONE! Setup complete."
