'use strict';

const { Router } = require('express');
const { webhookRateLimiter } = require('../middleware/rateLimit');
const rawBodyMiddleware = require('../middleware/rawBody');
const { handleFirefliesWebhook } = require('../controllers/fireflies.controller');

const router = Router();

/**
 * POST /webhooks/fireflies
 *
 * Middleware stack (order is critical):
 *   1. Rate limiter    — basic flood protection
 *   2. rawBody         — capture raw bytes for HMAC verification, then parse JSON
 *   3. Controller      — signature check, persist, async process
 */
router.post(
  '/fireflies',
  webhookRateLimiter,
  rawBodyMiddleware,
  handleFirefliesWebhook,
);

module.exports = router;
