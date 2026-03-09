'use strict';

const logger = require('../utils/logger');

/**
 * Centralized error handler middleware.
 * Must be registered as the last app.use() call.
 *
 * Catches errors thrown or passed via next(err) in route handlers.
 * Never leaks internal details in production responses.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        status,
      },
      req: {
        method: req.method,
        url: req.url,
        ip: req.ip,
      },
    },
    'Unhandled request error',
  );

  const isProd = process.env.NODE_ENV === 'production';

  res.status(status).json({
    error: isProd && status >= 500 ? 'Internal server error' : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
}

module.exports = errorHandler;
