#!/bin/bash
# Run on the server (e.g. Ubuntu on Hetzner) to expose worklog-dashboard via Nginx + HTTPS.
# Usage: sudo ./setup-webserver.sh worklog-dashboard.development-test.website
# Prereq: DNS A record for the domain must already point to this server's IP.

set -e

DOMAIN="${1:?Usage: $0 <domain>   e.g. $0 worklog-dashboard.development-test.website}"
APP_DIR="/opt/worklog-dashboard"
APP_PORT=3200

echo ">>> Installing Nginx and Certbot..."
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

echo ">>> Creating Nginx config for $DOMAIN (proxying to port $APP_PORT)..."
cat > /etc/nginx/sites-available/worklog-dashboard << EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Dashboard is internal — Basic Auth is handled by the app itself.
    # Do NOT cache API or dashboard responses.
    add_header Cache-Control "no-store, no-cache, must-revalidate";

    location / {
        proxy_pass         http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        # Forward Basic Auth header through to the app
        proxy_set_header   Authorization     \$http_authorization;
    }
}
EOF

ln -sf /etc/nginx/sites-available/worklog-dashboard /etc/nginx/sites-enabled/

echo ">>> Testing Nginx config..."
nginx -t

echo ">>> Reloading Nginx..."
systemctl reload nginx

echo ">>> Requesting TLS certificate (Let's Encrypt)..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || true

echo ""
echo ">>> Done!"
echo "    Dashboard URL:  https://$DOMAIN"
echo "    Health check:   curl -I https://$DOMAIN/health"
echo ""
echo ">>> Next steps:"
echo "    1. cd $APP_DIR"
echo "    2. docker compose --profile migrate run --rm migrate"
echo "    3. docker compose up -d app"
echo ""
echo ">>> Optional: lock down with firewall (ports 22, 80, 443 only)"
echo "    ufw allow ssh && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable"
echo ""
