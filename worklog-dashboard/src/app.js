const express = require('express');
const helmet  = require('helmet');
const pinoHttp = require('pino-http');
const path    = require('path');

const logger         = require('./utils/logger');
const auth           = require('./middleware/auth');
const errorHandler   = require('./middleware/errorHandler');
const dashboardRoutes     = require('./routes/dashboard');
const settingsRoutes      = require('./routes/settings');
const syncRoutes          = require('./routes/sync');
const contradictionRoutes = require('./routes/contradictions');
const mappingRoutes       = require('./routes/mappings');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", 'data:'],
      },
    },
  })
);

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/health' },
  })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));

// ── Health check (unauthenticated — needed by Docker / load balancer) ─────────
app.get('/health', (_req, res) => res.json({ ok: true, service: 'worklog-dashboard' }));

// ── Admin auth (all routes below require Basic Auth) ──────────────────────────
app.use(auth);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/settings',     settingsRoutes);
app.use('/api/sync',         syncRoutes);
app.use('/api/contradictions', contradictionRoutes);
app.use('/api/mappings',     mappingRoutes);

// ── Static frontend ───────────────────────────────────────────────────────────
const frontendDist = path.join(__dirname, '..', 'public');
app.use(express.static(frontendDist));
// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
