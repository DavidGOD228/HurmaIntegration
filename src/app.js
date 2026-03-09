'use strict';

const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const webhookRouter = require('./routes/webhooks');
const apiRouter = require('./routes/api');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// Trust reverse proxy (Nginx / Caddy) so req.ip reflects real client IP
app.set('trust proxy', 1);

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    // Don't log health-check noise
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
  }),
);

// NOTE: The webhook route uses rawBodyMiddleware — do NOT add express.json() globally
// before webhooks, it would consume the raw body needed for HMAC.

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/webhooks', webhookRouter);
app.use('/api', apiRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Centralized error handler (must be last) ──────────────────────────────────
app.use(errorHandler);

module.exports = app;
