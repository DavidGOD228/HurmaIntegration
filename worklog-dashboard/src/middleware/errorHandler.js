const logger = require('../utils/logger');
const config  = require('../config');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error({ err, method: req.method, url: req.url }, 'Unhandled error');
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error:   config.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(config.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
