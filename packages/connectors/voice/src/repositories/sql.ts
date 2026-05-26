/**
 * SQL Voice calls repository — target `voice_calls`.
 */

import type { VoiceCallRepository, VoiceCallRow } from './in-memory.js';

export interface SqlExecutorPort {
  readonly run: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<T | null>;
  readonly all: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<ReadonlyArray<T>>;
}

export function createSqlVoiceRepository(executor: SqlExecutorPort): VoiceCallRepository {
  return {
    async upsert(row) {
      const upserted = await executor.run<VoiceCallRow>(
        `INSERT INTO voice_calls
           (tenant_id, twilio_account, call_sid, direction, from_phone, to_phone,
            duration_s, recording_uri, transcript_text, raw, audit_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, twilio_account, call_sid)
         DO UPDATE SET direction=EXCLUDED.direction, from_phone=EXCLUDED.from_phone,
                       to_phone=EXCLUDED.to_phone, duration_s=EXCLUDED.duration_s,
                       recording_uri=EXCLUDED.recording_uri,
                       transcript_text=EXCLUDED.transcript_text,
                       raw=EXCLUDED.raw, audit_hash=EXCLUDED.audit_hash
         RETURNING *`,
        [
          row.tenantId, row.twilioAccount, row.callSid,
          row.payload.direction, row.payload.fromPhoneHashed, row.payload.toPhoneHashed,
          row.payload.durationS, row.payload.recordingUri, row.payload.transcriptText,
          JSON.stringify(row.raw), row.auditHash,
        ],
      );
      return upserted ?? row;
    },
    async findByKey(p) {
      return executor.run<VoiceCallRow>(
        `SELECT * FROM voice_calls WHERE tenant_id=$1 AND twilio_account=$2 AND call_sid=$3 LIMIT 1`,
        [p.tenantId, p.twilioAccount, p.callSid],
      );
    },
    async all() {
      return executor.all<VoiceCallRow>(`SELECT * FROM voice_calls ORDER BY ingested_at DESC`, []);
    },
  };
}
