'use strict';

const db = require('../index');

/**
 * Persist an incoming webhook payload before any processing.
 */
async function insertWebhook({ source, eventType, fireflysMeetingId, fireflysTranscriptId, payloadJson, signatureValid, userId = null }) {
  const result = await db.query(
    `INSERT INTO webhooks
       (source, event_type, fireflies_meeting_id, fireflies_transcript_id,
        payload_json, signature_valid, processing_status, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
     RETURNING id`,
    [source, eventType, fireflysMeetingId, fireflysTranscriptId, JSON.stringify(payloadJson), signatureValid, userId],
  );
  return result.rows[0];
}

/**
 * Check whether a webhook for this meeting ID was already successfully processed.
 * Used for idempotency on replay.
 */
async function findDoneWebhookByMeetingId(fireflysMeetingId) {
  const result = await db.query(
    `SELECT id, processing_status FROM webhooks
     WHERE fireflies_meeting_id = $1
       AND processing_status = 'done'
     LIMIT 1`,
    [fireflysMeetingId],
  );
  return result.rows[0] || null;
}

async function updateWebhookStatus(webhookId, status, errorMessage = null) {
  await db.query(
    `UPDATE webhooks
     SET processing_status = $2,
         processed_at      = NOW(),
         error_message     = $3
     WHERE id = $1`,
    [webhookId, status, errorMessage],
  );
}

async function getWebhookById(webhookId) {
  const result = await db.query('SELECT * FROM webhooks WHERE id = $1', [webhookId]);
  return result.rows[0] || null;
}

module.exports = { insertWebhook, findDoneWebhookByMeetingId, updateWebhookStatus, getWebhookById };
