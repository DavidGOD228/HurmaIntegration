'use strict';

const { Router } = require('express');
const { webhookRateLimiter } = require('../middleware/rateLimit');
const rawBodyMiddleware = require('../middleware/rawBody');
const { handleFirefliesWebhook } = require('../controllers/fireflies.controller');

const router = Router();

// Single-user legacy route (uses env vars)
router.post('/fireflies', webhookRateLimiter, rawBodyMiddleware, handleFirefliesWebhook);

// Per-user route — each recruiter gets their own URL with their token
router.post('/fireflies/:token', webhookRateLimiter, rawBodyMiddleware, handleFirefliesWebhook);

module.exports = router;
