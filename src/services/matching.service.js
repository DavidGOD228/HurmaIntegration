'use strict';

/**
 * Candidate matching service.
 *
 * Resolution priority (per specification):
 *   1. HURMA_CANDIDATE_ID from meeting description
 *   2. CID:<id> from meeting title
 *   3. Fireflies clientReferenceId
 *   4. candidate_links table (pre-configured mappings)
 *   5. Email match from transcript attendees (fallback)
 *   6. Manual review if nothing resolves
 */

const { parseCandidateId } = require('../utils/regex');
const candidateLinksQ = require('../db/queries/candidateLinks');
const hurmaService = require('./hurma.service');
const logger = require('../utils/logger');

/**
 * Resolve the Hurma candidate ID from available transcript and meeting metadata.
 *
 * @param {object} transcript  - Normalized Fireflies transcript object
 * @param {object} webhookBody - Raw webhook payload (may contain clientReferenceId)
 * @returns {Promise<{candidateId: string|null, matchedBy: string|null}>}
 */
async function resolveCandidateId(transcript, webhookBody) {
  const title = transcript.title || '';
  const description = extractDescriptionFromTranscript(transcript, webhookBody);

  // ── Priority 1 & 2: Parse from meeting description / title ──────────────────
  const { candidateId: parsedId, matchedBy: parseMethod } = parseCandidateId(description, title);
  if (parsedId) {
    logger.info({ candidateId: parsedId, matchedBy: parseMethod }, 'Candidate matched via metadata pattern');
    return { candidateId: parsedId, matchedBy: parseMethod };
  }

  // ── Priority 3: Fireflies clientReferenceId ──────────────────────────────────
  const clientRef = webhookBody?.clientReferenceId || webhookBody?.client_reference_id || null;
  if (clientRef) {
    logger.info({ clientRef }, 'Candidate matched via clientReferenceId');
    return { candidateId: String(clientRef), matchedBy: 'client_reference_id' };
  }

  // ── Priority 4: candidate_links table ────────────────────────────────────────
  // Try each attendee email against candidate_links
  for (const attendee of transcript.attendees || []) {
    if (!attendee.email) continue;
    const link = await candidateLinksQ.findByExternalReference(attendee.email);
    if (link) {
      logger.info({ email: attendee.email, candidateId: link.hurma_candidate_id }, 'Candidate matched via candidate_links table');
      return { candidateId: link.hurma_candidate_id, matchedBy: 'candidate_links' };
    }
  }

  // ── Priority 5: Email search in Hurma (expensive, last real fallback) ─────────
  for (const attendee of transcript.attendees || []) {
    if (!attendee.email) continue;
    try {
      const candidate = await hurmaService.findCandidateByEmail(attendee.email);
      if (candidate) {
        logger.info({ email: attendee.email, candidateId: candidate.id }, 'Candidate matched via email search in Hurma');
        return { candidateId: String(candidate.id), matchedBy: 'email_fallback' };
      }
    } catch (err) {
      // Don't abort matching on Hurma search failure; try next attendee
      logger.warn({ email: attendee.email, err: err.message }, 'Hurma email search failed during matching');
    }
  }

  // ── Priority 6: Manual review ─────────────────────────────────────────────────
  logger.warn({ title, description }, 'Could not resolve Hurma candidate ID — queuing for manual review');
  return { candidateId: null, matchedBy: null };
}

/**
 * Extract the meeting description from various locations in Fireflies data.
 * Fireflies may return meeting description nested differently depending on
 * how the event was created.
 */
function extractDescriptionFromTranscript(transcript, webhookBody) {
  // Fireflies transcript sentences don't include description, but
  // meeting_link or custom fields might. We also check webhook payload.
  const parts = [
    webhookBody?.meetingDescription,
    webhookBody?.meeting_description,
    // Some Fireflies webhooks embed description in the payload directly
    webhookBody?.description,
  ].filter(Boolean);

  return parts.join(' ') || '';
}

module.exports = { resolveCandidateId };
