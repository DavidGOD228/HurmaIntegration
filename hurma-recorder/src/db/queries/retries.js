'use strict';

const db = require('../index');

const MAX_ATTEMPTS = 5;

/**
 * Exponential backoff delay in minutes: 2, 4, 8, 16, 32
 */
function backoffMinutes(attemptNumber) {
  return Math.pow(2, attemptNumber);
}

async function createRetry(webhookId, attemptNumber, lastError) {
  const delayMinutes = backoffMinutes(attemptNumber);
  const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000);

  const result = await db.query(
    `INSERT INTO retries (webhook_id, attempt_number, next_retry_at, last_error)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [webhookId, attemptNumber, nextRetryAt, lastError],
  );
  return result.rows[0];
}

async function getPendingRetries() {
  const result = await db.query(
    `SELECT r.*, w.payload_json, w.fireflies_meeting_id, w.fireflies_transcript_id
     FROM retries r
     JOIN webhooks w ON w.id = r.webhook_id
     WHERE r.next_retry_at <= NOW()
       AND r.attempt_number <= $1
       AND w.processing_status IN ('failed', 'pending')
     ORDER BY r.next_retry_at ASC
     LIMIT 50`,
    [MAX_ATTEMPTS],
  );
  return result.rows;
}

async function getLatestAttemptForWebhook(webhookId) {
  const result = await db.query(
    `SELECT MAX(attempt_number) AS attempt_number FROM retries WHERE webhook_id = $1`,
    [webhookId],
  );
  return result.rows[0]?.attempt_number || 0;
}

async function deleteRetriesForWebhook(webhookId) {
  await db.query('DELETE FROM retries WHERE webhook_id = $1', [webhookId]);
}

module.exports = { createRetry, getPendingRetries, getLatestAttemptForWebhook, deleteRetriesForWebhook, MAX_ATTEMPTS };
