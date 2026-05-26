/**
 * SQL Teams messages repository — target `teams_messages`.
 */

import type { TeamsMessageRepository, TeamsMessageRow } from './in-memory.js';

export interface SqlExecutorPort {
  readonly run: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<T | null>;
  readonly all: <T>(sql: string, params: ReadonlyArray<unknown>) => Promise<ReadonlyArray<T>>;
}

export function createSqlTeamsRepository(executor: SqlExecutorPort): TeamsMessageRepository {
  return {
    async upsert(row) {
      const upserted = await executor.run<TeamsMessageRow>(
        `INSERT INTO teams_messages
           (tenant_id, account, team_id, channel_id, message_id, from_user,
            content, attachments, sent_at, raw, audit_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, account, team_id, channel_id, message_id)
         DO UPDATE SET from_user=EXCLUDED.from_user, content=EXCLUDED.content,
                       attachments=EXCLUDED.attachments, sent_at=EXCLUDED.sent_at,
                       raw=EXCLUDED.raw, audit_hash=EXCLUDED.audit_hash
         WHERE teams_messages.sent_at < EXCLUDED.sent_at
         RETURNING *`,
        [
          row.tenantId, row.account, row.teamId, row.channelId, row.messageId,
          row.payload.fromDisplayName, row.payload.content,
          JSON.stringify(row.payload.attachments), row.payload.sentAt,
          JSON.stringify(row.raw), row.auditHash,
        ],
      );
      return upserted ?? row;
    },
    async findByKey(p) {
      return executor.run<TeamsMessageRow>(
        `SELECT * FROM teams_messages WHERE tenant_id=$1 AND account=$2 AND team_id=$3 AND channel_id=$4 AND message_id=$5 LIMIT 1`,
        [p.tenantId, p.account, p.teamId, p.channelId, p.messageId],
      );
    },
    async all() {
      return executor.all<TeamsMessageRow>(`SELECT * FROM teams_messages ORDER BY ingested_at DESC`, []);
    },
  };
}
