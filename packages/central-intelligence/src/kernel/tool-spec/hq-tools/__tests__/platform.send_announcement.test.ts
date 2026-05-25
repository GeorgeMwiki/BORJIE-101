import { describe, it, expect } from 'vitest';
import {
  createSendAnnouncementTool,
  type AnnouncementPort,
  type SendAnnouncementOutput,
} from '../platform.send_announcement.js';
import {
  buildCtx,
  makeInMemorySovereignLedger,
  TENANT_SCOPED_SCOPES,
} from './test-rig.js';

function stub(opts: { recipientCount?: number } = {}): {
  port: AnnouncementPort;
  recalls: Array<{ announcementId: string }>;
} {
  const recalls: Array<{ announcementId: string }> = [];
  return {
    recalls,
    port: {
      async send(args): Promise<SendAnnouncementOutput> {
        return {
          announcementId: `ann-${args.scope}-${args.channel}`,
          scope: args.scope,
          channel: args.channel,
          subject: args.subject,
          recipientCount: opts.recipientCount ?? 25,
          scheduledFor: args.scheduleAt ?? '2026-05-15T09:00:00.000Z',
          status: 'queued',
        };
      },
      async recall(args) {
        recalls.push({ announcementId: args.announcementId });
      },
    },
  };
}

const COMMS_SCOPES = ['platform:comms:write', 'platform:ops:write'];

describe('platform.send_announcement', () => {
  it('happy path — sends global banner', async () => {
    const { port } = stub();
    const tool = createSendAnnouncementTool({
      announcements: port,
      maxRecipientCount: 10_000,
    });
    const out = await tool.execute(
      {
        scope: 'global',
        channel: 'banner',
        subject: 'Scheduled maintenance',
        body: 'Tonight 02:00-04:00 EAT.',
      },
      buildCtx({ scopes: COMMS_SCOPES }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.status).toBe('queued');
  });

  it('refuses + auto-recalls when recipient count over ceiling', async () => {
    const { port, recalls } = stub({ recipientCount: 50_000 });
    const tool = createSendAnnouncementTool({
      announcements: port,
      maxRecipientCount: 10_000,
    });
    const out = await tool.execute(
      {
        scope: 'global',
        channel: 'email',
        subject: 'mass blast',
        body: 'mass blast body',
      },
      buildCtx({ scopes: COMMS_SCOPES }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('DOMAIN_LIMIT_EXCEEDED');
    expect(recalls).toHaveLength(1);
  });

  it('auth-gated — missing comms:write refused', async () => {
    const { port } = stub();
    const tool = createSendAnnouncementTool({
      announcements: port,
      maxRecipientCount: 10_000,
    });
    const out = await tool.execute(
      {
        scope: 'global',
        channel: 'banner',
        subject: 'x',
        body: 'y',
      },
      buildCtx({ scopes: ['platform:ops:write'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('refuses tenant scope the caller cannot reach', async () => {
    const { port } = stub();
    const tool = createSendAnnouncementTool({
      announcements: port,
      maxRecipientCount: 10_000,
    });
    const out = await tool.execute(
      {
        scope: 'tenant:t-beta',
        channel: 'banner',
        subject: 'x',
        body: 'y',
      },
      buildCtx({
        scopes: [...COMMS_SCOPES, ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    expect(out.kind).toBe('refused');
  });

  it('emits sovereign-ledger row at external-comm tier', async () => {
    const { port } = stub();
    const ledger = makeInMemorySovereignLedger();
    const tool = createSendAnnouncementTool({
      announcements: port,
      maxRecipientCount: 10_000,
    });
    await tool.execute(
      {
        scope: 'global',
        channel: 'banner',
        subject: 'planned downtime',
        body: '02:00-04:00',
      },
      buildCtx({ scopes: COMMS_SCOPES, sovereignLedger: ledger }),
    );
    expect(ledger.rows[0].riskTier).toBe('external-comm');
    expect(ledger.rows[0].approvalRequired).toBe(true);
  });

  it('rollback recalls the announcement', async () => {
    const { port, recalls } = stub();
    const tool = createSendAnnouncementTool({
      announcements: port,
      maxRecipientCount: 10_000,
    });
    const out = await tool.execute(
      {
        scope: 'global',
        channel: 'banner',
        subject: 'x',
        body: 'y',
      },
      buildCtx({ scopes: COMMS_SCOPES }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx({ scopes: COMMS_SCOPES }));
    expect(recalls.length).toBeGreaterThanOrEqual(1);
  });
});
