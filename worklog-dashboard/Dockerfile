# ── Stage 1: build React frontend ───────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
# Output goes to /app/frontend/../public → /app/public (configured in vite.config.js)

# ── Stage 2: install backend deps ────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 3: runtime image ────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Backend dependencies
COPY --from=deps /app/node_modules ./node_modules

# Backend source
COPY src/ ./src/
COPY package.json ./

# Built frontend (served as static files by Express)
COPY --from=frontend-builder /app/public ./public

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3200

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3200/health || exit 1

CMD ["node", "src/server.js"]
