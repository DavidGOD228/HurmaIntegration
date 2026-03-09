'use strict';

const { z } = require('zod');
const config = require('../config');
const logger = require('../utils/logger');
const { verifyFirefliesSignature } = require('../utils/signature');
const webhooksQ = require('../db/queries/webhooks');
const processingService = require('../services/processing.service');

/**
 * Zod schema for the expected Fireflies webhook payload.
 * Fireflies sends at minimum: eventType and meetingId.
 * We accept extra fields with .passthrough() for forward-compatibility.
 */
const webhookPayloadSchema = z
  .object({
    eventType: z.string(),
    meetingId: z.string().optional(),
    transcriptId: z.string().optional(),
    // Fireflies may use either key name
    meeting_id: z.string().optional(),
    transcript_id: z.string().optional(),
  })
  .passthrough();

/**
 * POST /webhooks/fireflies
 *
 * 1. Capture raw body for signature verification
 * 2. Verify HMAC-SHA256 signature from x-hub-signature header
 * 3. Validate payload structure
 * 4. Persist raw webhook to DB
 * 5. Return 200 immediately (async processing)
 * 6. Trigger async processing in background
 */
async function handleFirefliesWebhook(req, res, next) {
  const signature = req.headers['x-hub-signature'];
  const rawBody = req.rawBody;

  // ── Signature verification ─────────────────────────────────────────────────
  let signatureValid = false;
  try {
    signatureValid = verifyFirefliesSignature(rawBody, signature, config.FIREFLIES_WEBHOOK_SECRET);
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    logger.warn({ ip: req.ip, signature }, 'Invalid Fireflies webhook signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // ── Payload validation ────────────────────────────────────────────────────
  const parsed = webhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.issues }, 'Invalid Fireflies webhook payload');
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues });
  }

  const payload = parsed.data;
  const eventType = payload.eventType;

  // Normalize field names — Fireflies uses both camel and snake_case in docs
  const fireflysMeetingId = payload.meetingId || payload.meeting_id || null;
  const fireflysTranscriptId = payload.transcriptId || payload.transcript_id || fireflysMeetingId;

  // ── Persist webhook (must happen before responding) ───────────────────────
  let webhookRow;
  try {
    webhookRow = await webhooksQ.insertWebhook({
      source: 'fireflies',
      eventType,
      fireflysMeetingId,
      fireflysTranscriptId,
      payloadJson: payload,
      signatureValid: true,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to persist webhook to DB');
    return next(err);
  }

  // ── Idempotency: check if this meeting was already successfully processed ──
  if (fireflysMeetingId) {
    const done = await webhooksQ.findDoneWebhookByMeetingId(fireflysMeetingId);
    if (done) {
      logger.info({ fireflysMeetingId, existingWebhookId: done.id }, 'Duplicate webhook — already processed');
      await webhooksQ.updateWebhookStatus(webhookRow.id, 'duplicate');
      return res.status(200).json({ status: 'duplicate', message: 'Already processed' });
    }
  }

  // ── Acknowledge immediately, process asynchronously ────────────────────────
  res.status(200).json({ status: 'accepted', webhookId: webhookRow.id });

  // ── Only process transcription complete events ─────────────────────────────
  const TRANSCRIPTION_EVENTS = [
    'Transcription complete',
    'transcription_complete',
    'TRANSCRIPTION_COMPLETE',
  ];

  if (!TRANSCRIPTION_EVENTS.includes(eventType)) {
    logger.info({ eventType, webhookId: webhookRow.id }, 'Ignoring non-transcription event');
    await webhooksQ.updateWebhookStatus(webhookRow.id, 'skipped', `Unsupported event type: ${eventType}`);
    return;
  }

  if (!fireflysMeetingId && !fireflysTranscriptId) {
    logger.warn({ webhookId: webhookRow.id }, 'Webhook missing meetingId and transcriptId — skipping');
    await webhooksQ.updateWebhookStatus(webhookRow.id, 'failed', 'Missing meetingId/transcriptId');
    return;
  }

  // Run processing asynchronously — do not await here
  setImmediate(() => {
    processingService
      .processFirefliesWebhook(webhookRow.id, fireflysMeetingId, fireflysTranscriptId, payload)
      .catch((err) => {
        logger.error({ webhookId: webhookRow.id, err: err.message }, 'Unhandled error in async processing');
      });
  });
}

module.exports = { handleFirefliesWebhook };
