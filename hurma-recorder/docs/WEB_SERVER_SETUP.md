# Web server setup (Nginx + HTTPS)

So Fireflies can send webhooks to your integration, the app must be reachable at a **public HTTPS URL**.

---

## What you need first

1. **A domain name** that you control (e.g. `hooks.yourcompany.com`, or a subdomain of any domain you own).
2. **DNS**: an A record pointing that domain to your server IP (e.g. `204.168.151.135`).

Example in your DNS provider:

| Type | Name  | Value           | TTL  |
|------|--------|-----------------|------|
| A    | hooks  | 204.168.151.135 | 300  |

Then `hooks.yourcompany.com` will resolve to your Hetzner server.

---

## Option A: Run the script (easiest)

On the server, from the project directory:

```bash
cd /opt/hurma-recorder
chmod +x scripts/setup-webserver.sh
sudo ./scripts/setup-webserver.sh hooks.yourcompany.com
```

Replace `hooks.yourcompany.com` with your real domain.  
When finished, your webhook URL will be:

**`https://hooks.yourcompany.com/webhooks/fireflies`**

Use this URL (and the same `FIREFLIES_WEBHOOK_SECRET` as in `.env`) when configuring the webhook in Fireflies.

---

## Option B: Manual steps

### 1. Install Nginx and Certbot

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### 2. Create Nginx config

Replace `YOUR_DOMAIN` with your domain (e.g. `hooks.yourcompany.com`):

```bash
sudo nano /etc/nginx/sites-available/hurma-recorder
```

Paste (with your domain):

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN;

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
```

Save and exit.

### 3. Enable the site and reload Nginx

```bash
sudo ln -s /etc/nginx/sites-available/hurma-recorder /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Get an HTTPS certificate

```bash
sudo certbot --nginx -d YOUR_DOMAIN
```

Follow the prompts (agree to terms, optional email). Certbot will configure HTTPS and redirect HTTP → HTTPS.

### 5. (Optional) Firewall

Only ports 22, 80, 443 need to be open. Port 3000 stays local.

```bash
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## Check that it works

- From your machine:  
  `curl -I https://YOUR_DOMAIN/health`  
  You should see `200 OK` and no certificate errors.

- In Fireflies: add a webhook with URL  
  `https://YOUR_DOMAIN/webhooks/fireflies`  
  and the same secret as in your server `.env` (`FIREFLIES_WEBHOOK_SECRET`).

---

## Troubleshooting

| Problem | What to do |
|--------|------------|
| **certbot fails** (e.g. “could not find a matching server”) | Make sure the Nginx `server_name` is exactly your domain and `nginx -t` passes. Then run certbot again. |
| **502 Bad Gateway** | App not running. Run `docker compose ps` and `docker compose up -d` in `/opt/hurma-recorder`. |
| **Connection refused** | Nginx can’t reach the app. Check the app is listening on `127.0.0.1:3000` and Nginx `proxy_pass` is `http://127.0.0.1:3000`. |
| **DNS not resolving** | Wait for DNS TTL (up to a few minutes). Check with `dig YOUR_DOMAIN` or an online DNS checker. |
