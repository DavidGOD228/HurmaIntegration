require('dotenv').config();
const app    = require('./app');
const db     = require('./db');
const config = require('./config');
const logger = require('./utils/logger');
const { runFullSync } = require('./services/sync.service');
const { toDateString } = require('./utils/workdays');

let cron;
try { cron = require('node-cron'); } catch { cron = null; }

async function start() {
  // Verify DB connectivity
  await db.ping();
  logger.info('Database connection OK');

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'Worklog Dashboard listening');
  });

  // ── Scheduled sync jobs ────────────────────────────────────────────────────
  if (cron) {
    // Full sync every morning at 06:00 (server timezone)
    cron.schedule('0 6 * * *', () => {
      const now  = new Date();
      const from = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));
      const to   = toDateString(now);
      logger.info({ from, to }, 'Scheduled full sync starting');
      runFullSync(from, to).catch((err) => logger.error({ err }, 'Scheduled full sync failed'));
    });

    // Incremental time-entries + summary sync every hour
    cron.schedule('0 * * * *', () => {
      const now  = new Date();
      const from = toDateString(now);
      const to   = toDateString(now);
      logger.info('Hourly incremental sync starting');
      runFullSync(from, to).catch((err) => logger.error({ err }, 'Hourly sync failed'));
    });

    logger.info('Cron jobs scheduled: full sync 06:00 daily, incremental sync hourly');
  } else {
    logger.warn('node-cron not available — scheduled syncs disabled');
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down...');
    server.close(async () => {
      await db.end();
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
