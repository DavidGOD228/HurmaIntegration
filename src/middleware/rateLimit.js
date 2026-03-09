'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for the webhook endpoint.
 * Protects against abuse; Fireflies should only send one webhook per meeting.
 * Adjust windowMs / max based on expected volume in production.
 */
const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute window
  max: 120,             // generous for batch replays
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    // Allow health checks from localhost without rate limiting
    return req.ip === '127.0.0.1' || req.ip === '::1';
  },
});

module.exports = { webhookRateLimiter };
