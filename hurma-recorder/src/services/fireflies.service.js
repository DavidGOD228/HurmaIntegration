'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql';

const TRANSCRIPT_QUERY = `
  query GetTranscript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      title
      date
      duration
      meeting_link
      transcript_url
      audio_url
      video_url
      organizer_email
      meeting_attendees {
        displayName
        email
      }
      summary {
        short_summary
        action_items
        topics_discussed
        keywords
      }
    }
  }
`;

/**
 * Build an axios instance for Fireflies with auth header.
 * @param {string} [apiKey] - Override API key (for multi-user). Falls back to env var.
 */
function buildClient(apiKey) {
  return axios.create({
    baseURL: FIREFLIES_GRAPHQL_URL,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey || config.FIREFLIES_API_KEY}`,
    },
    timeout: 30000,
  });
}

/**
 * Fetch full transcript data from Fireflies GraphQL API by transcript ID.
 *
 * @param {string} transcriptId - Fireflies transcript ID from webhook payload
 * @param {string} [apiKey]     - Per-user Fireflies API key (optional)
 * @returns {Promise<object>} Normalized transcript data
 */
async function fetchTranscript(transcriptId, apiKey) {
  const client = buildClient(apiKey);

  logger.info({ transcriptId }, 'Fetching Fireflies transcript');

  let response;
  try {
    response = await client.post('', {
      query: TRANSCRIPT_QUERY,
      variables: { transcriptId },
    });
  } catch (err) {
    const body = err.response?.data;
    logger.error(
      { transcriptId, status: err.response?.status, body: JSON.stringify(body).slice(0, 500) },
      'Fireflies API HTTP error',
    );
    throw err;
  }

  if (response.data.errors && response.data.errors.length > 0) {
    const errorMsg = response.data.errors.map((e) => e.message).join('; ');
    logger.error(
      { transcriptId, graphqlErrors: response.data.errors },
      'Fireflies GraphQL error response',
    );
    throw new Error(`Fireflies GraphQL error: ${errorMsg}`);
  }

  const transcript = response.data?.data?.transcript;
  if (!transcript) {
    throw new Error(`Transcript not found in Fireflies API for id: ${transcriptId}`);
  }

  logger.info({ transcriptId, title: transcript.title }, 'Fireflies transcript fetched');

  return normalizeTranscript(transcript);
}

/**
 * Normalize raw Fireflies API response into a structured internal format.
 */
function normalizeTranscript(raw) {
  const summary = raw.summary || {};
  const attendees = raw.meeting_attendees || [];

  return {
    id: raw.id,
    title: raw.title || null,
    date: raw.date ? new Date(Number(raw.date)) : null,
    duration: raw.duration || null,
    meetingLink: raw.meeting_link || null,
    transcriptUrl: raw.transcript_url || null,
    audioUrl: raw.audio_url || null,
    videoUrl: raw.video_url || null,
    organizerEmail: raw.organizer_email || null,
    attendees: attendees.map((a) => ({
      name: a.displayName || null,
      email: a.email || null,
    })),
    summary: {
      shortSummary: summary.short_summary || null,
      actionItems: summary.action_items || null,
      topicsDiscussed: summary.topics_discussed || null,
      keywords: summary.keywords || null,
    },
    raw,
  };
}

module.exports = { fetchTranscript };
