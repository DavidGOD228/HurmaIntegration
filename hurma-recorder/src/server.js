'use strict';

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./db');
const { startRetryPoller } = require('./services/retry.service');

let retryTimer = null;
let server = null;

async function start() {
  // ── Verify DB connectivity ──────────────────────────────────────────────────
  try {
    await db.ping();
    logger.info('Database connection established');
  } catch (err) {
    logger.fatal({ err: err.message }, 'Cannot connect to database — aborting startup');
    process.exit(1);
  }

  // ── Start HTTP server ──────────────────────────────────────────────────────
  server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'HurmaRecorder service started');
  });

  // ── Start retry poller (every 60 seconds) ─────────────────────────────────
  retryTimer = startRetryPoller(60_000);

  return server;
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');

  if (retryTimer) clearInterval(retryTimer);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
    logger.info('HTTP server closed');
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message }, 'Uncaught exception — shutting down');
  process.exit(1);
});

start().catch((err) => {
  logger.fatal({ err: err.message }, 'Startup failed');
  process.exit(1);
});
