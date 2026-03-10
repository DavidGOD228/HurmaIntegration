'use strict';

/**
 * Candidate matching service.
 *
 * Resolution priority:
 *   1. HURMA_CANDIDATE_ID=<id>  from meeting description  (explicit, zero-ambiguity)
 *   2. CID:<id>                 from meeting title         (explicit)
 *   3. Fireflies clientReferenceId                         (explicit)
 *   4. candidate_links table    — cached email/name → id   (fast, no Hurma API call)
 *   5. Email search in Hurma    — attendee email lookup    (automatic)
 *   6. Name search in Hurma     — attendee names + title   (automatic fallback)
 *   7. Manual review            — none of the above worked
 *
 * Successful automatic matches (5, 6) are written to candidate_links so
 * subsequent meetings with the same person are resolved from cache (priority 4).
 */

const { parseCandidateId, extractNameFromTitle } = require('../utils/regex');
const candidateLinksQ = require('../db/queries/candidateLinks');
const hurmaService = require('./hurma.service');
const logger = require('../utils/logger');

/**
 * Resolve the Hurma candidate ID from available transcript and meeting metadata.
 *
 * @param {object} transcript  - Normalized Fireflies transcript object
 * @param {object} webhookBody - Raw webhook payload (may contain clientReferenceId)
 * @param {object} [user]      - User row from DB (for Hurma API searches)
 * @returns {Promise<{candidateId: string|null, matchedBy: string|null}>}
 */
async function resolveCandidateId(transcript, webhookBody, user) {
  const title = transcript.title || '';
  const description = extractDescriptionFromTranscript(transcript, webhookBody);

  // ── Priority 1 & 2: HURMA_CANDIDATE_ID= or CID: in description/title ────────
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

  // ── Priority 4: candidate_links cache ────────────────────────────────────────
  const attendees = transcript.attendees || [];

  for (const attendee of attendees) {
    if (!attendee.email) continue;
    const link = await candidateLinksQ.findByExternalReference(attendee.email);
    if (link) {
      logger.info({ email: attendee.email, candidateId: link.hurma_candidate_id }, 'Candidate matched via candidate_links cache');
      return { candidateId: link.hurma_candidate_id, matchedBy: 'candidate_links' };
    }
  }

  // Check name cache too (may have been cached from a previous name match)
  for (const attendee of attendees) {
    if (!attendee.name) continue;
    const link = await candidateLinksQ.findByExternalReference(attendee.name.toLowerCase());
    if (link) {
      logger.info({ name: attendee.name, candidateId: link.hurma_candidate_id }, 'Candidate matched via name cache');
      return { candidateId: link.hurma_candidate_id, matchedBy: 'candidate_links_name' };
    }
  }

  // ── Priority 5: Email search in Hurma ────────────────────────────────────────
  // Skip the organizer email — that's the recruiter, not the candidate.
  // If Fireflies provides organizer_email, we can compare against known recruiters.
  const organizerEmail = transcript.organizerEmail || null;

  for (const attendee of attendees) {
    if (!attendee.email) continue;
    if (attendee.email === organizerEmail) continue; // skip the recruiter

    try {
      const candidate = await hurmaService.findCandidateByEmail(attendee.email, user);
      if (candidate) {
        const candidateId = String(candidate.id);
        logger.info({ email: attendee.email, candidateId }, 'Candidate matched via Hurma email search');

        // Cache for next time
        await cacheLink(attendee.email, candidateId, 'email');

        return { candidateId, matchedBy: 'email_search' };
      }
    } catch (err) {
      logger.warn({ email: attendee.email, err: err.message }, 'Hurma email search failed — trying next attendee');
    }
  }

  // ── Priority 6: Name search in Hurma ─────────────────────────────────────────
  // Build a deduplicated list of names to try:
  // a) attendee display names (excluding organizer)
  // b) name extracted from meeting title
  const namesToTry = buildNameCandidates(title, attendees, organizerEmail);

  for (const name of namesToTry) {
    try {
      const candidate = await hurmaService.findCandidateByName(name, user);
      if (candidate) {
        const candidateId = String(candidate.id);
        logger.info({ name, candidateId }, 'Candidate matched via Hurma name search');

        // Cache name → id for future meetings with same person
        await cacheLink(name.toLowerCase(), candidateId, 'name');

        return { candidateId, matchedBy: 'name_search' };
      }
    } catch (err) {
      logger.warn({ name, err: err.message }, 'Hurma name search failed — trying next name');
    }
  }

  // ── Priority 7: Manual review ─────────────────────────────────────────────────
  logger.warn(
    { title, attendeeCount: attendees.length, description: description.slice(0, 200) },
    'Could not resolve Hurma candidate ID — queuing for manual review',
  );
  return { candidateId: null, matchedBy: null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract meeting description from various Fireflies/webhook locations.
 */
function extractDescriptionFromTranscript(transcript, webhookBody) {
  const parts = [
    // Webhook payload fields (Fireflies may embed description here)
    webhookBody?.meetingDescription,
    webhookBody?.meeting_description,
    webhookBody?.description,
    // Fireflies calendar_description field (if present on transcript object)
    transcript?.calendarDescription,
    transcript?.meetingDescription,
  ].filter(Boolean);

  return parts.join(' ') || '';
}

/**
 * Build a deduplicated list of full names to try in Hurma name search.
 * Prioritizes names that look like "Firstname Lastname" (≥2 words, capitalised).
 */
function buildNameCandidates(title, attendees, organizerEmail) {
  const seen = new Set();
  const names = [];

  // From meeting title
  const titleName = extractNameFromTitle(title);
  if (titleName && !seen.has(titleName)) {
    seen.add(titleName);
    names.push(titleName);
  }

  // From attendee display names — skip the organizer and one-word names
  for (const attendee of attendees) {
    if (!attendee.name) continue;
    if (attendee.email && attendee.email === organizerEmail) continue;
    const name = attendee.name.trim();
    if (name.includes(' ') && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

/**
 * Write an external-reference → candidateId mapping to cache.
 * Errors are non-fatal (just logged).
 */
async function cacheLink(key, candidateId, type) {
  try {
    await candidateLinksQ.insertCandidateLink(key, candidateId);
    logger.debug({ key, candidateId, type }, 'Cached candidate_link');
  } catch (err) {
    logger.warn({ key, err: err.message }, 'Failed to cache candidate_link — non-fatal');
  }
}

module.exports = { resolveCandidateId };
