'use strict';

const { z } = require('zod');
const config = require('../config');
const logger = require('../utils/logger');
const { verifyFirefliesSignature } = require('../utils/signature');
const webhooksQ = require('../db/queries/webhooks');
const usersQ = require('../db/queries/users');
const processingService = require('../services/processing.service');

const webhookPayloadSchema = z
  .object({
    eventType: z.string(),
    meetingId: z.string().optional(),
    transcriptId: z.string().optional(),
    meeting_id: z.string().optional(),
    transcript_id: z.string().optional(),
  })
  .passthrough();

/**
 * Shared handler for both:
 *   POST /webhooks/fireflies          (single-user, env vars)
 *   POST /webhooks/fireflies/:token   (multi-user, per-user credentials)
 */
async function handleFirefliesWebhook(req, res, next) {
  const signature = req.headers['x-hub-signature'];
  const rawBody = req.rawBody;

  // ── Resolve user and secret ───────────────────────────────────────────────
  let user = null;
  let webhookSecret = config.FIREFLIES_WEBHOOK_SECRET;

  if (req.params.token) {
    user = await usersQ.findByToken(req.params.token);
    if (!user) {
      logger.warn({ token: req.params.token }, 'Webhook token not found');
      return res.status(404).json({ error: 'Unknown webhook token' });
    }
    webhookSecret = user.fireflies_webhook_secret;
  }

  // ── Signature verification ─────────────────────────────────────────────────
  let signatureValid = false;
  try {
    signatureValid = verifyFirefliesSignature(rawBody, signature, webhookSecret);
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    logger.warn({ ip: req.ip, userToken: req.params.token || 'global' }, 'Invalid Fireflies webhook signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // ── Payload validation ────────────────────────────────────────────────────
  const parsed = webhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
  }

  const payload = parsed.data;
  const eventType = payload.eventType;
  const fireflysMeetingId = payload.meetingId || payload.meeting_id || null;
  const fireflysTranscriptId = payload.transcriptId || payload.transcript_id || fireflysMeetingId;

  // ── Persist webhook ───────────────────────────────────────────────────────
  let webhookRow;
  try {
    webhookRow = await webhooksQ.insertWebhook({
      source: 'fireflies',
      eventType,
      fireflysMeetingId,
      fireflysTranscriptId,
      payloadJson: payload,
      signatureValid: true,
      userId: user?.id || null,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to persist webhook');
    return next(err);
  }

  // ── Idempotency ───────────────────────────────────────────────────────────
  if (fireflysMeetingId) {
    const done = await webhooksQ.findDoneWebhookByMeetingId(fireflysMeetingId);
    if (done) {
      logger.info({ fireflysMeetingId }, 'Duplicate webhook — already processed');
      await webhooksQ.updateWebhookStatus(webhookRow.id, 'duplicate');
      return res.status(200).json({ status: 'duplicate', message: 'Already processed' });
    }
  }

  // ── Acknowledge immediately ────────────────────────────────────────────────
  res.status(200).json({ status: 'accepted', webhookId: webhookRow.id });

  // ── Filter event type ─────────────────────────────────────────────────────
  const TRANSCRIPTION_EVENTS = ['Transcription complete', 'transcription_complete', 'TRANSCRIPTION_COMPLETE'];
  if (!TRANSCRIPTION_EVENTS.includes(eventType)) {
    await webhooksQ.updateWebhookStatus(webhookRow.id, 'skipped', `Unsupported event: ${eventType}`);
    return;
  }

  if (!fireflysMeetingId && !fireflysTranscriptId) {
    await webhooksQ.updateWebhookStatus(webhookRow.id, 'failed', 'Missing meetingId/transcriptId');
    return;
  }

  // ── Async processing ──────────────────────────────────────────────────────
  setImmediate(() => {
    processingService
      .processFirefliesWebhook(webhookRow.id, fireflysMeetingId, fireflysTranscriptId, payload, user)
      .catch((err) => {
        logger.error({ webhookId: webhookRow.id, err: err.message }, 'Unhandled error in async processing');
      });
  });
}

module.exports = { handleFirefliesWebhook };
