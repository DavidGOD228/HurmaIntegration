'use strict';

const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'FIREFLIES_API_KEY',
      'HURMA_API_TOKEN',
      'FIREFLIES_WEBHOOK_SECRET',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
