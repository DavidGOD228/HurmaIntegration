const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.LOG_LEVEL,
  redact: ['hurmaToken', 'redmineKey', 'password', 'ADMIN_PASSWORD'],
  ...(config.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    },
  }),
});

module.exports = logger;
