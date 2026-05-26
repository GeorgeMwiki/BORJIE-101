/**
 * SQL Zoom meetings repository — target `zoom_meetings`.
 */

import type { ZoomMeetingRepository, ZoomMeetingRow } from './in-memory.js';

export interface SqlExecutorPort {
  readonly run: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<T | null>;
  readonly all: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<ReadonlyArray<T>>;
}

export function createSqlZoomRepository(executor: SqlExecutorPort): ZoomMeetingRepository {
  return {
    async upsert(row) {
      const upserted = await executor.run<ZoomMeetingRow>(
        `INSERT INTO zoom_meetings
           (tenant_id, account, meeting_id, topic, start_at, end_at,
            participants, recording_uri, transcript_text, raw, audit_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, account, meeting_id)
         DO UPDATE SET topic=EXCLUDED.topic, start_at=EXCLUDED.start_at,
                       end_at=EXCLUDED.end_at, participants=EXCLUDED.participants,
                       recording_uri=EXCLUDED.recording_uri,
                       transcript_text=EXCLUDED.transcript_text,
                       raw=EXCLUDED.raw, audit_hash=EXCLUDED.audit_hash
         WHERE zoom_meetings.start_at <= EXCLUDED.start_at
         RETURNING *`,
        [
          row.tenantId, row.account, row.meetingId,
          row.payload.topic, row.payload.startAt, row.payload.endAt,
          JSON.stringify(row.payload.participants),
          row.payload.recordingUri, row.payload.transcriptText,
          JSON.stringify(row.raw), row.auditHash,
        ],
      );
      return upserted ?? row;
    },
    async findByKey(p) {
      return executor.run<ZoomMeetingRow>(
        `SELECT * FROM zoom_meetings WHERE tenant_id=$1 AND account=$2 AND meeting_id=$3 LIMIT 1`,
        [p.tenantId, p.account, p.meetingId],
      );
    },
    async all() {
      return executor.all<ZoomMeetingRow>(`SELECT * FROM zoom_meetings ORDER BY ingested_at DESC`, []);
    },
  };
}
