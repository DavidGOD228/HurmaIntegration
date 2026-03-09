#!/bin/bash
# Run on the server (e.g. Ubuntu on Hetzner) to expose HurmaRecorder via Nginx + HTTPS.
# Usage: sudo ./setup-webserver.sh your-domain.com
# Prereq: DNS for your-domain.com must point to this server's IP.

set -e

DOMAIN="${1:?Usage: $0 <domain>   e.g. $0 hooks.yourcompany.com}"

echo ">>> Installing Nginx and Certbot..."
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

echo ">>> Creating Nginx config for $DOMAIN..."
cat > /etc/nginx/sites-available/hurma-recorder << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/hurma-recorder /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo ">>> Testing Nginx config..."
nginx -t

echo ">>> Reloading Nginx..."
systemctl reload nginx

echo ">>> Requesting TLS certificate (Let's Encrypt)..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || true

echo ""
echo ">>> Done. Your webhook URL is:"
echo "    https://$DOMAIN/webhooks/fireflies"
echo ""
echo ">>> Optional: enable firewall (ports 22, 80, 443 only)"
echo "    ufw allow ssh && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable"
echo ""
