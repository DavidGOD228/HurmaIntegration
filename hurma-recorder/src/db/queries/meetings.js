'use strict';

const db = require('../index');

async function upsertMeeting({ fireflysMeetingId, fireflysTranscriptId, hurmaCandidateId, title, description, status, matchedBy }) {
  const result = await db.query(
    `INSERT INTO meetings
       (fireflies_meeting_id, fireflies_transcript_id, hurma_candidate_id,
        title, description, status, matched_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (fireflies_meeting_id) DO UPDATE SET
       fireflies_transcript_id = EXCLUDED.fireflies_transcript_id,
       hurma_candidate_id      = COALESCE(EXCLUDED.hurma_candidate_id, meetings.hurma_candidate_id),
       title                   = COALESCE(EXCLUDED.title, meetings.title),
       description             = COALESCE(EXCLUDED.description, meetings.description),
       status                  = EXCLUDED.status,
       matched_by              = EXCLUDED.matched_by,
       updated_at              = NOW()
     RETURNING id`,
    [fireflysMeetingId, fireflysTranscriptId, hurmaCandidateId, title, description, status, matchedBy],
  );
  return result.rows[0];
}

async function getMeetingByFirefliesId(fireflysMeetingId) {
  const result = await db.query(
    'SELECT * FROM meetings WHERE fireflies_meeting_id = $1',
    [fireflysMeetingId],
  );
  return result.rows[0] || null;
}

async function updateMeetingStatus(meetingId, status) {
  await db.query(
    'UPDATE meetings SET status = $2, updated_at = NOW() WHERE id = $1',
    [meetingId, status],
  );
}

module.exports = { upsertMeeting, getMeetingByFirefliesId, updateMeetingStatus };
