'use strict';

/**
 * Regex patterns used to extract Hurma candidate IDs from meeting metadata.
 *
 * Hurma candidate IDs are alphanumeric strings (e.g. "Je", "74LI"), NOT plain integers.
 *
 * Resolution priority in the description/title:
 *   1. Hurma profile URL  → https://company.hurma.work/candidates/show/74LI
 *   2. HURMA_CANDIDATE_ID=74LI (injected by Chrome extension)
 *   3. CID:74LI in title
 */
const PATTERNS = {
  // Priority 1: full Hurma candidate URL in description
  // Matches: https://xxx.hurma.work/candidates/show/74LI
  HURMA_CANDIDATE_URL: /hurma\.work\/candidates\/show\/([A-Za-z0-9]+)/i,

  // Priority 2: explicit marker injected by the Chrome extension
  CANDIDATE_ID_DESCRIPTION: /HURMA_CANDIDATE_ID=([A-Za-z0-9]+)/i,

  // Priority 3: CID shorthand in title or description
  CANDIDATE_ID_CID: /CID:([A-Za-z0-9]+)/i,

  // Extract a human name from common meeting title formats:
  //   "Interview with John Smith"    → "John Smith"
  //   "John Smith - Final Interview" → "John Smith"
  //   "Call | John Smith"            → "John Smith"
  INTERVIEW_TITLE_NAME: [
    /interview(?:\s+with)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-–|]/,
    /[-–|]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
  ],
};

/**
 * Extracts candidate ID from a Hurma profile URL embedded in the description.
 * e.g. https://bestwork.hurma.work/candidates/show/74LI → "74LI"
 */
function extractCandidateIdFromUrl(text) {
  if (!text) return null;
  const match = text.match(PATTERNS.HURMA_CANDIDATE_URL);
  return match ? match[1] : null;
}

/**
 * Extracts the Hurma candidate ID from the HURMA_CANDIDATE_ID= marker.
 */
function extractCandidateIdFromDescription(description) {
  if (!description) return null;
  const match = description.match(PATTERNS.CANDIDATE_ID_DESCRIPTION);
  return match ? match[1] : null;
}

/**
 * Extracts the Hurma candidate ID from CID:<id> in the title.
 */
function extractCandidateIdFromTitle(title) {
  if (!title) return null;
  const match = title.match(PATTERNS.CANDIDATE_ID_CID);
  return match ? match[1] : null;
}

/**
 * Tries all description/title ID extraction methods in order.
 *
 * @param {string} description
 * @param {string} title
 * @returns {{ candidateId: string|null, matchedBy: string|null }}
 */
function parseCandidateId(description, title) {
  // 1. Hurma profile URL in description (recruiter pastes/copies the profile link)
  const fromUrl = extractCandidateIdFromUrl(description);
  if (fromUrl) return { candidateId: fromUrl, matchedBy: 'hurma_url_in_description' };

  // 2. Explicit HURMA_CANDIDATE_ID= marker (Chrome extension auto-inject)
  const fromDesc = extractCandidateIdFromDescription(description);
  if (fromDesc) return { candidateId: fromDesc, matchedBy: 'description_pattern' };

  // 3. CID: shorthand in title
  const fromTitle = extractCandidateIdFromTitle(title);
  if (fromTitle) return { candidateId: fromTitle, matchedBy: 'title_cid_pattern' };

  return { candidateId: null, matchedBy: null };
}

/**
 * Tries to extract a candidate full name from the meeting title.
 * Returns null if no clear name pattern is detected.
 */
function extractNameFromTitle(title) {
  if (!title) return null;
  for (const pattern of PATTERNS.INTERVIEW_TITLE_NAME) {
    const match = title.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

module.exports = {
  parseCandidateId,
  extractCandidateIdFromUrl,
  extractCandidateIdFromDescription,
  extractCandidateIdFromTitle,
  extractNameFromTitle,
};
