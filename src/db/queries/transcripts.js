'use strict';

const db = require('../index');

async function upsertTranscript({ meetingId, transcriptUrl, audioUrl, videoUrl, shortSummary, actionItemsJson, topicsDiscussedJson, rawTranscriptJson }) {
  const result = await db.query(
    `INSERT INTO transcripts
       (meeting_id, transcript_url, audio_url, video_url,
        short_summary, action_items_json, topics_discussed_json, raw_transcript_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      meetingId,
      transcriptUrl,
      audioUrl,
      videoUrl,
      shortSummary,
      actionItemsJson ? JSON.stringify(actionItemsJson) : null,
      topicsDiscussedJson ? JSON.stringify(topicsDiscussedJson) : null,
      rawTranscriptJson ? JSON.stringify(rawTranscriptJson) : null,
    ],
  );
  // If conflict (already exists), fetch the existing row
  if (result.rowCount === 0) {
    const existing = await db.query('SELECT id FROM transcripts WHERE meeting_id = $1 LIMIT 1', [meetingId]);
    return existing.rows[0];
  }
  return result.rows[0];
}

module.exports = { upsertTranscript };
