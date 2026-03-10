#!/bin/bash
# Nginx HTTP-only setup (no domain, no HTTPS). App reachable at http://YOUR_SERVER_IP/
# Run on server: sudo ./setup-webserver-http-only.sh

set -e

echo ">>> Installing Nginx..."
apt-get update -qq
apt-get install -y -qq nginx

echo ">>> Creating Nginx config (listen on port 80, proxy to app)..."
cat > /etc/nginx/sites-available/hurma-recorder << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
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

echo ""
echo ">>> Done. Get your server IP with: curl -s ifconfig.me"
echo ">>> Webhook URL (replace with your IP):"
echo "    http://YOUR_SERVER_IP/webhooks/fireflies"
echo ">>> Health check: http://YOUR_SERVER_IP/health"
echo ""
echo ">>> Optional: open firewall for HTTP"
echo "    ufw allow 80/tcp && ufw --force enable"
echo ""
