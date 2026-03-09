'use strict';

/**
 * Main orchestration service.
 * Coordinates Fireflies fetch → candidate matching → Hurma note creation.
 */

const firefliesService = require('./fireflies.service');
const hurmaService = require('./hurma.service');
const matchingService = require('./matching.service');

const meetingsQ = require('../db/queries/meetings');
const transcriptsQ = require('../db/queries/transcripts');
const webhooksQ = require('../db/queries/webhooks');
const hurmanoteQ = require('../db/queries/hurmaNote');
const manualReviewQ = require('../db/queries/manualReview');
const retriesQ = require('../db/queries/retries');

const { hashContent } = require('../utils/idempotency');
const logger = require('../utils/logger');

/**
 * Format the note that will be posted to Hurma.
 *
 * @param {object} transcript - Normalized Fireflies transcript
 * @param {object} meetingMeta - { fireflies_meeting_id, fireflies_transcript_id, title }
 * @returns {string}
 */
function buildNoteContent(transcript, meetingMeta) {
  const lines = [
    'Interview synced automatically from Fireflies',
    '',
    `Meeting title: ${transcript.title || meetingMeta.title || '(unknown)'}`,
    transcript.date ? `Meeting date:  ${transcript.date.toISOString().split('T')[0]}` : null,
    transcript.duration ? `Duration:      ${Math.round(transcript.duration / 60)} min` : null,
    `Fireflies meeting ID:    ${meetingMeta.fireflies_meeting_id}`,
    meetingMeta.fireflies_transcript_id
      ? `Fireflies transcript ID: ${meetingMeta.fireflies_transcript_id}`
      : null,
    '',
  ].filter((l) => l !== null);

  if (transcript.attendees && transcript.attendees.length > 0) {
    lines.push('Participants:');
    transcript.attendees.forEach((a) => {
      lines.push(`  - ${a.name || ''}${a.email ? ` <${a.email}>` : ''}`);
    });
    lines.push('');
  }

  if (transcript.summary?.shortSummary) {
    lines.push('Summary:');
    lines.push(transcript.summary.shortSummary);
    lines.push('');
  }

  if (transcript.summary?.actionItems) {
    lines.push('Action items:');
    const items = Array.isArray(transcript.summary.actionItems)
      ? transcript.summary.actionItems
      : [transcript.summary.actionItems];
    items.forEach((item) => lines.push(`  - ${item}`));
    lines.push('');
  }

  if (transcript.summary?.topicsDiscussed) {
    lines.push('Topics discussed:');
    lines.push(transcript.summary.topicsDiscussed);
    lines.push('');
  }

  if (transcript.transcriptUrl) lines.push(`Transcript: ${transcript.transcriptUrl}`);
  if (transcript.audioUrl) lines.push(`Audio:      ${transcript.audioUrl}`);
  if (transcript.videoUrl) lines.push(`Video:      ${transcript.videoUrl}`);

  lines.push('', '---', 'Sync source: Fireflies -> Integration Service -> Hurma');

  return lines.join('\n');
}

/**
 * Process a single Fireflies transcription webhook end-to-end.
 *
 * @param {number} webhookId             - DB id of the persisted webhook row
 * @param {string} fireflysMeetingId     - From webhook payload
 * @param {string} fireflysTranscriptId  - From webhook payload
 * @param {object} webhookBody           - Full parsed webhook payload
 */
async function processFirefliesWebhook(
  webhookId,
  fireflysMeetingId,
  fireflysTranscriptId,
  webhookBody,
) {
  logger.info(
    { webhookId, fireflysMeetingId, fireflysTranscriptId },
    'Starting webhook processing',
  );

  // ── Step 1: Fetch transcript from Fireflies ───────────────────────────────
  let transcript;
  try {
    transcript = await firefliesService.fetchTranscript(fireflysTranscriptId);
  } catch (err) {
    logger.error(
      { webhookId, fireflysTranscriptId, err: err.message },
      'Fireflies transcript fetch failed',
    );
    await webhooksQ.updateWebhookStatus(webhookId, 'failed', err.message);
    await scheduleRetry(webhookId, err.message);
    return;
  }

  // ── Step 2: Resolve candidate ID ─────────────────────────────────────────
  const description =
    webhookBody?.meetingDescription || webhookBody?.meeting_description || webhookBody?.description || '';

  const { candidateId, matchedBy } = await matchingService.resolveCandidateId(
    transcript,
    webhookBody,
  );

  // ── Step 3: Upsert meeting record ─────────────────────────────────────────
  const meetingRow = await meetingsQ.upsertMeeting({
    fireflysMeetingId,
    fireflysTranscriptId,
    hurmaCandidateId: candidateId,
    title: transcript.title,
    description,
    status: candidateId ? 'matched' : 'unmatched',
    matchedBy,
  });

  // ── Step 4: Persist raw transcript for auditing ───────────────────────────
  await transcriptsQ.upsertTranscript({
    meetingId: meetingRow.id,
    transcriptUrl: transcript.transcriptUrl,
    audioUrl: transcript.audioUrl,
    videoUrl: transcript.videoUrl,
    shortSummary: transcript.summary?.shortSummary,
    actionItemsJson: transcript.summary?.actionItems,
    topicsDiscussedJson: transcript.summary?.topicsDiscussed,
    rawTranscriptJson: transcript.raw,
  });

  // ── Step 5: Handle unresolved candidate ──────────────────────────────────
  if (!candidateId) {
    await manualReviewQ.insertManualReview({
      fireflysMeetingId,
      fireflysTranscriptId,
      reason:
        'Could not resolve Hurma candidate ID from meeting metadata or attendees',
      payloadJson: webhookBody,
    });
    await meetingsQ.updateMeetingStatus(meetingRow.id, 'unmatched');
    await webhooksQ.updateWebhookStatus(
      webhookId,
      'done',
      'queued for manual review — candidate unresolved',
    );
    logger.warn({ webhookId, fireflysMeetingId }, 'Meeting queued for manual review');
    return;
  }

  // ── Step 6: Verify candidate exists in Hurma ─────────────────────────────
  let hurmaCandidate;
  try {
    hurmaCandidate = await hurmaService.getCandidateById(candidateId);
  } catch (err) {
    logger.error({ candidateId, err: err.message }, 'Hurma candidate lookup failed');
    await webhooksQ.updateWebhookStatus(webhookId, 'failed', err.message);
    await scheduleRetry(webhookId, err.message);
    return;
  }

  if (!hurmaCandidate) {
    const reason = `Hurma candidate ID "${candidateId}" not found in Hurma`;
    logger.warn({ candidateId }, reason);
    await manualReviewQ.insertManualReview({
      fireflysMeetingId,
      fireflysTranscriptId,
      reason,
      payloadJson: webhookBody,
    });
    await meetingsQ.updateMeetingStatus(meetingRow.id, 'failed');
    await webhooksQ.updateWebhookStatus(webhookId, 'done', reason);
    return;
  }

  // ── Step 7: Build note and idempotency check ──────────────────────────────
  const noteContent = buildNoteContent(transcript, {
    fireflies_meeting_id: fireflysMeetingId,
    fireflies_transcript_id: fireflysTranscriptId,
    title: transcript.title,
  });

  const contentHash = hashContent(noteContent);

  const existingNote = await hurmanoteQ.findNoteByHash(candidateId, contentHash);
  if (existingNote) {
    logger.info({ candidateId, contentHash }, 'Duplicate note detected — skipping Hurma write');
    await webhooksQ.updateWebhookStatus(webhookId, 'duplicate');
    return;
  }

  // ── Step 8: Post comment to Hurma ─────────────────────────────────────────
  let hurmaResponse;
  try {
    hurmaResponse = await hurmaService.createCandidateComment(candidateId, noteContent);
  } catch (err) {
    logger.error({ candidateId, err: err.message }, 'Hurma createCandidateComment failed');
    await meetingsQ.updateMeetingStatus(meetingRow.id, 'failed');
    await webhooksQ.updateWebhookStatus(webhookId, 'failed', err.message);
    await scheduleRetry(webhookId, err.message);
    return;
  }

  // ── Step 9: Record success ────────────────────────────────────────────────
  await hurmanoteQ.insertNote({
    meetingId: meetingRow.id,
    hurmaCandidateId: candidateId,
    hummaNoteExternalId: hurmaResponse?.id ? String(hurmaResponse.id) : null,
    contentHash,
  });

  await meetingsQ.updateMeetingStatus(meetingRow.id, 'processed');
  await webhooksQ.updateWebhookStatus(webhookId, 'done');
  await retriesQ.deleteRetriesForWebhook(webhookId);

  logger.info(
    { webhookId, candidateId, fireflysMeetingId },
    'Webhook processing complete — note created in Hurma',
  );
}

/**
 * Schedule a retry for a failed webhook, respecting the MAX_ATTEMPTS cap.
 */
async function scheduleRetry(webhookId, errorMessage) {
  const currentAttempt = await retriesQ.getLatestAttemptForWebhook(webhookId);

  if (currentAttempt >= retriesQ.MAX_ATTEMPTS) {
    logger.error(
      { webhookId, currentAttempt },
      'Max retry attempts reached — marking as permanently failed',
    );
    await webhooksQ.updateWebhookStatus(
      webhookId,
      'failed',
      `Max attempts (${retriesQ.MAX_ATTEMPTS}) exceeded. Last error: ${errorMessage}`,
    );
    return;
  }

  const retry = await retriesQ.createRetry(webhookId, currentAttempt + 1, errorMessage);
  logger.info({ webhookId, attempt: currentAttempt + 1, retryId: retry.id }, 'Retry scheduled');
}

module.exports = { processFirefliesWebhook, buildNoteContent };
