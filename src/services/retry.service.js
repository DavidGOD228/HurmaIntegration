'use strict';

/**
 * Retry service.
 * Polls the retries table for due items and re-runs processing.
 * Designed to run on a timer and be restart-safe (no in-memory state).
 */

const retriesQ = require('../db/queries/retries');
const webhooksQ = require('../db/queries/webhooks');
const processingService = require('./processing.service');
const logger = require('../utils/logger');

let isRunning = false;

/**
 * Process all retries that are due (next_retry_at <= NOW()).
 * Idempotent — safe to call from multiple timer ticks.
 */
async function processDueRetries() {
  if (isRunning) {
    logger.debug('Retry processor already running, skipping tick');
    return;
  }

  isRunning = true;
  try {
    const dueRetries = await retriesQ.getPendingRetries();

    if (dueRetries.length === 0) {
      logger.debug('No due retries found');
      return;
    }

    logger.info({ count: dueRetries.length }, 'Processing due retries');

    for (const retry of dueRetries) {
      await processRetry(retry);
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Retry processor error');
  } finally {
    isRunning = false;
  }
}

async function processRetry(retry) {
  logger.info(
    { webhookId: retry.webhook_id, attempt: retry.attempt_number },
    'Retrying webhook processing',
  );

  const webhook = await webhooksQ.getWebhookById(retry.webhook_id);
  if (!webhook) {
    logger.warn({ retryId: retry.id }, 'Webhook not found for retry — skipping');
    return;
  }

  let body;
  try {
    body = typeof webhook.payload_json === 'string'
      ? JSON.parse(webhook.payload_json)
      : webhook.payload_json;
  } catch {
    logger.error({ retryId: retry.id }, 'Could not parse webhook payload for retry');
    return;
  }

  // Reset status to allow re-processing
  await webhooksQ.updateWebhookStatus(webhook.id, 'processing');

  await processingService.processFirefliesWebhook(
    webhook.id,
    webhook.fireflies_meeting_id,
    webhook.fireflies_transcript_id,
    body,
  );
}

/**
 * Start the retry poller interval.
 *
 * @param {number} intervalMs - How often to check for due retries (default 60s)
 * @returns {NodeJS.Timeout} Timer handle (store to clear on shutdown)
 */
function startRetryPoller(intervalMs = 60_000) {
  logger.info({ intervalMs }, 'Retry poller started');
  return setInterval(() => {
    processDueRetries().catch((err) => {
      logger.error({ err: err.message }, 'Unhandled error in retry poller');
    });
  }, intervalMs);
}

module.exports = { processDueRetries, startRetryPoller };
