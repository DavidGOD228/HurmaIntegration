'use strict';

const { z } = require('zod');
const usersQ = require('../db/queries/users');
const webhooksQ = require('../db/queries/webhooks');
const processingService = require('../services/processing.service');
const hurmaService = require('../services/hurma.service');
const logger = require('../utils/logger');
const config = require('../config');

const registerSchema = z.object({
  name: z.string().min(1).optional().default('Recruiter'),
  email: z.string().email().optional(),
  fireflies_api_key: z.string().min(1),
  fireflies_webhook_secret: z.string().min(1),
  hurma_api_token: z.string().min(1),
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

  const { name, email, fireflies_api_key, fireflies_webhook_secret, hurma_api_token } = parsed.data;

  try {
    const user = await usersQ.createUser({
      name,
      email,
      firefliesApiKey: fireflies_api_key,
      firefliesWebhookSecret: fireflies_webhook_secret,
      hurmaApiToken: hurma_api_token,
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

const triggerSchema = z.object({
  transcript_id: z.string().min(1),
  meeting_id: z.string().min(1).optional(),
});

/**
 * POST /api/users/trigger
 * Authorization: Bearer <webhook_token>
 * Body: { transcript_id, meeting_id? }
 *
 * Manually kick off processing for a Fireflies transcript that was missed
 * (e.g. webhook was not configured when the meeting was recorded).
 */
async function triggerProcessing(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });

  try {
    const user = await usersQ.findByToken(token);
    if (!user) return res.status(404).json({ error: 'User not found or inactive' });

    const parsed = triggerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const { transcript_id, meeting_id } = parsed.data;
    const effectiveMeetingId = meeting_id || transcript_id;

    // Persist a webhook record so processing results are tracked
    const webhookRow = await webhooksQ.insertWebhook({
      source: 'manual_trigger',
      eventType: 'Transcription complete',
      fireflysMeetingId: effectiveMeetingId,
      fireflysTranscriptId: transcript_id,
      payloadJson: { transcript_id, meeting_id: effectiveMeetingId, triggered_by: 'api' },
      signatureValid: true,
      userId: user.id,
    });

    logger.info(
      { webhookId: webhookRow.id, transcript_id, userId: user.id },
      'Manual trigger requested',
    );

    // Acknowledge immediately, process async
    res.status(202).json({
      status: 'accepted',
      webhook_id: webhookRow.id,
      message: 'Processing started — check Recent Meetings in the extension in ~30 seconds.',
    });

    setImmediate(() => {
      processingService
        .processFirefliesWebhook(
          webhookRow.id,
          effectiveMeetingId,
          transcript_id,
          { eventType: 'Transcription complete', meetingId: effectiveMeetingId, transcriptId: transcript_id },
          user,
        )
        .catch((err) => {
          logger.error({ webhookId: webhookRow.id, err: err.message }, 'Unhandled error in manual trigger processing');
        });
    });
  } catch (err) {
    return next(err);
  }
}

const oauthSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/users/hurma-oauth
 * Authorization: Bearer <webhook_token>
 * Body: { email: "your.hurma@email.com", password: "yourpassword" }
 *
 * One-time setup: exchanges Hurma credentials for OAuth tokens and stores them.
 * After this, all Hurma API calls use auto-refreshing JWT tokens.
 */
async function setupHurmaOAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });

  try {
    const user = await usersQ.findByToken(token);
    if (!user) return res.status(404).json({ error: 'User not found or inactive' });

    const parsed = oauthSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }

    const { email, password } = parsed.data;
    await hurmaService.setupOAuth(user.id, email, password);

    logger.info({ userId: user.id }, 'Hurma OAuth setup complete');
    return res.json({ status: 'ok', message: 'Hurma OAuth tokens configured. Integration is now active.' });
  } catch (err) {
    logger.error({ err: err.message }, 'Hurma OAuth setup failed');
    return res.status(400).json({ error: 'OAuth setup failed', detail: err.message });
  }
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

module.exports = { register, getMe, triggerProcessing, setupHurmaOAuth };
