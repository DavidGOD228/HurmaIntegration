'use strict';

const { z } = require('zod');
const usersQ = require('../db/queries/users');
const logger = require('../utils/logger');
const config = require('../config');

const registerSchema = z.object({
  name: z.string().min(1).optional().default('Recruiter'),
  email: z.string().email().optional(),
  fireflies_api_key: z.string().min(1),
  fireflies_webhook_secret: z.string().min(1),
});

/**
 * POST /api/users/register
 * Body: { name, email?, fireflies_api_key, fireflies_webhook_secret }
 * Returns: { webhook_token, webhook_url, name }
 */
async function register(req, res, next) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  }

  const { name, email, fireflies_api_key, fireflies_webhook_secret } = parsed.data;

  try {
    const user = await usersQ.createUser({
      name,
      email,
      firefliesApiKey: fireflies_api_key,
      firefliesWebhookSecret: fireflies_webhook_secret,
    });

    const baseUrl = config.APP_BASE_URL || `http://localhost:${config.PORT}`;
    const webhookUrl = `${baseUrl}/webhooks/fireflies/${user.webhook_token}`;

    logger.info({ userId: user.id, name }, 'New user registered');

    return res.status(201).json({
      name: user.name,
      webhook_token: user.webhook_token,
      webhook_url: webhookUrl,
      message: `Copy the webhook_url into your Fireflies Settings → Webhook. Use your fireflies_webhook_secret as the webhook secret there.`,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/users/me
 * Authorization: Bearer <webhook_token>
 * Returns: user info + recent activity
 */
async function getMe(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });

  try {
    const user = await usersQ.findByToken(token);
    if (!user) return res.status(404).json({ error: 'User not found or inactive' });

    const activity = await usersQ.getRecentActivity(user.id, 10);
    const baseUrl = config.APP_BASE_URL || `http://localhost:${config.PORT}`;

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      webhook_url: `${baseUrl}/webhooks/fireflies/${user.webhook_token}`,
      created_at: user.created_at,
      recent_activity: activity,
    });
  } catch (err) {
    return next(err);
  }
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

module.exports = { register, getMe };
