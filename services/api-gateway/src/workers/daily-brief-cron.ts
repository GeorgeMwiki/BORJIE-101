/**
 * Daily Brief Cron — Wave OWNER-OS DAILY-BRIEF rebuild.
 *
 * Replaces the disabled BossNyumba `executive-brief-cron` with a mining-
 * native Borjie surface. Ticks every 5 minutes (env-tunable). For every
 * tenant whose `daily_brief_cadence` indicates a brief is due now in the
 * tenant's local timezone (Africa/Dar_es_Salaam fallback), the worker:
 *
 *   1. Composes today's brief via `composeOwnerBrief(db, tenantId)` —
 *      the SAME function the on-demand BFF uses (single composition
 *      path, no duplicate logic).
 *   2. Asks the brain ladder (Anthropic → OpenAI → DeepSeek) to write a
 *      warm time-aware EN+SW greeting + 3-sentence summary in
 *      Mr. Mwikila's voice and embeds it in the brief's `advisor` slice.
 *   3. Persists the composed brief into `owner_brief_snapshots` with
 *      `source = 'daily_cron'`.
 *   4. Dispatches the brief on every channel in
 *      `tenants.daily_brief_channels` to every recipient in
 *      `tenants.daily_brief_recipients`. Each dispatch is idempotent
 *      via UNIQUE(tenant_id, snapshot_date, channel, recipient) on
 *      `daily_brief_dispatches`.
 *   5. Hash-chains each dispatch into `ai_audit_chain` (best-effort —
 *      audit gap is logged but never blocks delivery).
 *
 * Failure containment:
 *   - DB unwired → no-op + warn once.
 *   - Per-tenant errors isolated — one bad tenant cannot poison the batch.
 *   - Per-recipient errors isolated — failed slack does not block email.
 *
 * Lifecycle:
 *   - `start()` arms an interval (default 5 min, override via
 *     `BORJIE_DAILY_BRIEF_CRON_INTERVAL_MS`).
 *   - `tickOnce()` exposed for tests and the manual-trigger endpoint.
 *   - `stop()` clears the timer.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { composeOwnerBrief, persistSnapshot } from '../routes/owner/brief.hono';
import { callBrainOnce } from '../routes/owner/brain-call';
import type {
  EmailProvider,
  SmsProvider,
} from '../services/notification-dispatch';

// ─────────────────────────────────────────────────────────────────────
// Public types + handle
// ─────────────────────────────────────────────────────────────────────

const ONE_MIN_MS = 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * ONE_MIN_MS;
const DEFAULT_TZ = 'Africa/Dar_es_Salaam';

export interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface DailyBriefRecipient {
  readonly userId?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly slackHandle?: string;
}

export interface DailyBriefCronOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly emailProvider: EmailProvider;
  readonly smsProvider: SmsProvider;
  /** Per-tenant Slack webhook resolver. NULL → skipped with reason. */
  readonly slackWebhookForTenant?: (tenantId: string) => string | null;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
}

export interface DailyBriefCronHandle {
  start(): void;
  stop(): void;
  /** Run one tick across every due tenant. */
  tickOnce(): Promise<TickResult>;
  /** Force a single tenant's brief NOW (manual trigger). */
  triggerForTenant(tenantId: string): Promise<TenantRunResult>;
}

export interface TickResult {
  readonly scanned: number;
  readonly generated: number;
  readonly dispatched: number;
  readonly failed: number;
}

export interface TenantRunResult {
  readonly tenantId: string;
  readonly generated: boolean;
  readonly snapshotId: string | null;
  readonly dispatched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly reason?: string;
}

interface DueTenant {
  readonly tenantId: string;
  readonly cadence: string;
  readonly channels: ReadonlyArray<'email' | 'sms' | 'slack'>;
  readonly recipients: ReadonlyArray<DailyBriefRecipient>;
  readonly localTimezone: string;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createDailyBriefCron(
  options: DailyBriefCronOptions,
): DailyBriefCronHandle {
  const envIntervalMs = Number(
    process.env.BORJIE_DAILY_BRIEF_CRON_INTERVAL_MS,
  );
  const intervalMs = Math.max(
    ONE_MIN_MS,
    options.intervalMs ??
      (Number.isFinite(envIntervalMs) && envIntervalMs > 0
        ? envIntervalMs
        : DEFAULT_INTERVAL_MS),
  );
  const enabled =
    options.enabled ??
    (process.env.NODE_ENV !== 'test' &&
      process.env.BORJIE_DAILY_BRIEF_CRON_DISABLED !== 'true');
  const nowFn = options.now ?? (() => new Date());

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick(): Promise<TickResult> {
    const counters = { scanned: 0, generated: 0, dispatched: 0, failed: 0 };
    if (running) return counters;
    running = true;
    const started = Date.now();
    try {
      const due = await fetchDueTenants(
        options.db,
        nowFn(),
        options.logger,
      );
      counters.scanned = due.length;
      for (const tenant of due) {
        try {
          const result = await runForTenant({
            ...options,
            tenant,
            now: nowFn(),
          });
          if (result.generated) counters.generated += 1;
          counters.dispatched += result.dispatched;
          counters.failed += result.failed;
        } catch (err) {
          counters.failed += 1;
          options.logger.error(
            {
              worker: 'daily-brief-cron',
              tenantId: tenant.tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'daily-brief-cron: tenant tick failed',
          );
        }
      }
      if (due.length > 0) {
        options.logger.info(
          { worker: 'daily-brief-cron', durationMs: Date.now() - started, ...counters },
          'daily-brief-cron: tick complete',
        );
      }
    } finally {
      running = false;
    }
    return counters;
  }

  return {
    start(): void {
      if (!enabled) {
        options.logger.info(
          { worker: 'daily-brief-cron' },
          'daily-brief-cron: disabled by config',
        );
        return;
      }
      if (timer) {
        options.logger.warn(
          { worker: 'daily-brief-cron' },
          'daily-brief-cron: already running',
        );
        return;
      }
      options.logger.info(
        { worker: 'daily-brief-cron', intervalMs },
        'daily-brief-cron: started',
      );
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
      // Fire once on boot so a fresh process picks up any backlog.
      void tick();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
        options.logger.info(
          { worker: 'daily-brief-cron' },
          'daily-brief-cron: stopped',
        );
      }
    },
    async tickOnce(): Promise<TickResult> {
      return tick();
    },
    async triggerForTenant(tenantId: string): Promise<TenantRunResult> {
      const tenant = await fetchTenantPrefs(
        options.db,
        tenantId,
        options.logger,
      );
      if (!tenant) {
        return {
          tenantId,
          generated: false,
          snapshotId: null,
          dispatched: 0,
          skipped: 0,
          failed: 0,
          reason: 'tenant_not_found',
        };
      }
      return runForTenant({ ...options, tenant, now: nowFn() });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-tenant run
// ─────────────────────────────────────────────────────────────────────

interface RunForTenantArgs {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly emailProvider: EmailProvider;
  readonly smsProvider: SmsProvider;
  readonly slackWebhookForTenant?: (tenantId: string) => string | null;
  readonly tenant: DueTenant;
  readonly now: Date;
}

async function runForTenant(
  args: RunForTenantArgs,
): Promise<TenantRunResult> {
  const { tenant, db, logger, now } = args;
  const snapshotDate = isoDateInTz(now, tenant.localTimezone);

  // Step 1 — compose the seven-slot brief (single composition path).
  const briefBase = await composeOwnerBrief(db, tenant.tenantId);

  // Step 2 — overlay the warm Mr. Mwikila greeting via the brain ladder.
  const advisor = await composeMwikilaGreeting({
    brief: briefBase,
    now,
    tenantTimezone: tenant.localTimezone,
    logger,
  }).catch((err) => {
    logger.warn(
      {
        worker: 'daily-brief-cron',
        tenantId: tenant.tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'daily-brief-cron: advisor compose failed (brief still persisted)',
    );
    return null;
  });

  const finalBrief = advisor
    ? {
        ...briefBase,
        advisor: {
          insight: advisor.insight,
          action: advisor.action,
          greetingEn: advisor.greetingEn,
          greetingSw: advisor.greetingSw,
          summaryEn: advisor.summaryEn,
          summarySw: advisor.summarySw,
          generatedAtIso: now.toISOString(),
          provider: advisor.provider,
          latencyMs: advisor.latencyMs,
        } as unknown as typeof briefBase.advisor,
      }
    : briefBase;

  // Step 3 — persist with source='daily_cron'. The widened CHECK in
  // migration 0092 admits the third value so the operator can tell the
  // rebuilt cron from the legacy 06:00 EAT consolidation cron.
  const persisted = await persistSnapshot(db, {
    tenantId: tenant.tenantId,
    brief: finalBrief,
    source: 'daily_cron',
    now,
  });

  // Step 4 — dispatch on each channel × recipient. Idempotent via UNIQUE
  // constraint on the dispatch ledger.
  let dispatched = 0;
  let skipped = 0;
  let failed = 0;
  for (const channel of tenant.channels) {
    for (const recipient of tenant.recipients) {
      const handle = pickHandle(channel, recipient);
      if (!handle) {
        await recordDispatch({
          db,
          logger,
          tenantId: tenant.tenantId,
          snapshotDate,
          channel,
          recipient: recipientLabel(channel, recipient),
          status: 'skipped',
          errorCode: 'no_handle_for_channel',
        });
        skipped += 1;
        continue;
      }
      // Insert-or-skip first so two ticks racing the same minute never
      // double-send. ON CONFLICT DO NOTHING returns zero rows when the
      // dispatch already exists — we skip in that case.
      const claimed = await claimDispatchRow({
        db,
        logger,
        tenantId: tenant.tenantId,
        snapshotDate,
        channel,
        recipient: handle,
      });
      if (!claimed) {
        skipped += 1;
        continue;
      }
      const result = await dispatchOne({
        ...args,
        channel,
        recipient: handle,
        recipientPayload: recipient,
        brief: finalBrief,
        snapshotDate,
      });
      await finaliseDispatch({
        db,
        logger,
        dispatchId: claimed.id,
        tenantId: tenant.tenantId,
        snapshotDate,
        channel,
        recipient: handle,
        result,
      });
      if (result.status === 'sent') dispatched += 1;
      else failed += 1;
    }
  }

  return {
    tenantId: tenant.tenantId,
    generated: true,
    snapshotId: persisted.id || null,
    dispatched,
    skipped,
    failed,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Brain greeting compose
// ─────────────────────────────────────────────────────────────────────

interface MwikilaGreetingArgs {
  readonly brief: Awaited<ReturnType<typeof composeOwnerBrief>>;
  readonly now: Date;
  readonly tenantTimezone: string;
  readonly logger: Logger;
}

interface MwikilaGreeting {
  readonly insight: string;
  readonly action: string;
  readonly greetingEn: string;
  readonly greetingSw: string;
  readonly summaryEn: string;
  readonly summarySw: string;
  readonly provider: string;
  readonly latencyMs: number;
}

async function composeMwikilaGreeting(
  args: MwikilaGreetingArgs,
): Promise<MwikilaGreeting | null> {
  const localHour = hourInTimezone(args.now, args.tenantTimezone);
  const slotEn = greetingSlotEn(localHour);
  const slotSw = greetingSlotSw(localHour);
  const summary = JSON.stringify({
    shiftsToday: args.brief.dailyBrief.shiftsToday,
    openIncidents: args.brief.dailyBrief.openIncidents,
    criticalIncidents: args.brief.dailyBrief.criticalIncidents,
    pendingDecisions: args.brief.decisions.pendingCount,
    cashNet90dTzs: args.brief.cashRunway.ninetyDayNetTzs,
    cashDailyAvgTzs: args.brief.cashRunway.dailyAvgTzs,
    productionPerSite: args.brief.productionVsTarget.perSite,
    cliffRemediation: args.brief.cliffStatus.remediationComplete,
    licencesAtRisk: args.brief.licenceHealth.atRiskCount,
    licencesTotal: args.brief.licenceHealth.totalCount,
  });
  const systemPrompt = `You are Mr. Mwikila, the Borjie strategic advisor for a Tanzanian mining owner. Read the JSON brief and respond with EXACTLY this 6-line shape — no extra prose, no markdown:

GREETING_EN: ${slotEn}, Mr. Mwikila here. <one warm sentence acknowledging today's situation>
GREETING_SW: ${slotSw}, mimi ni Mr. Mwikila. <sentensi moja ya joto kuhusu hali ya leo>
SUMMARY_EN: Three things on your plate today: <three short clauses joined by semicolons, <=45 words total>.
SUMMARY_SW: Mambo matatu yanayokusubiri leo: <vipande vitatu vifupi vya kiSwahili, <=45 maneno>.
INSIGHT: <one strategic insight, two sentences max>
ACTION: <one concrete next action, 14 words or fewer>

Never say "Karibu" in English. Never use emoji. Never invent figures the JSON does not show.`;
  const userPrompt = `Today's owner brief slots (JSON):\n${summary}`;
  const result = await callBrainOnce({
    systemPrompt,
    userPrompt,
    maxTokens: 480,
  });
  const fields = parseSixLineGreeting(result.text);
  if (!fields) return null;
  return {
    ...fields,
    provider: result.provider,
    latencyMs: result.latencyMs,
  };
}

function parseSixLineGreeting(text: string): {
  readonly insight: string;
  readonly action: string;
  readonly greetingEn: string;
  readonly greetingSw: string;
  readonly summaryEn: string;
  readonly summarySw: string;
} | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const find = (prefix: string): string | null => {
    const match = lines.find((l) =>
      l.toUpperCase().startsWith(prefix.toUpperCase()),
    );
    if (!match) return null;
    return match.slice(prefix.length).replace(/^[:\s]+/, '').trim();
  };
  const greetingEn = find('GREETING_EN');
  const greetingSw = find('GREETING_SW');
  const summaryEn = find('SUMMARY_EN');
  const summarySw = find('SUMMARY_SW');
  const insight = find('INSIGHT');
  const action = find('ACTION');
  if (!greetingEn || !greetingSw || !summaryEn || !summarySw || !insight || !action) {
    return null;
  }
  return { greetingEn, greetingSw, summaryEn, summarySw, insight, action };
}

function greetingSlotEn(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function greetingSlotSw(hour: number): string {
  if (hour < 12) return 'Habari za asubuhi';
  if (hour < 17) return 'Habari za mchana';
  return 'Habari za jioni';
}

// ─────────────────────────────────────────────────────────────────────
// Dispatch helpers
// ─────────────────────────────────────────────────────────────────────

interface DispatchOneArgs extends RunForTenantArgs {
  readonly channel: 'email' | 'sms' | 'slack';
  readonly recipient: string;
  readonly recipientPayload: DailyBriefRecipient;
  readonly brief: Awaited<ReturnType<typeof composeOwnerBrief>>;
  readonly snapshotDate: string;
}

interface DispatchResult {
  readonly status: 'sent' | 'failed';
  readonly providerMessageId?: string | null;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

async function dispatchOne(args: DispatchOneArgs): Promise<DispatchResult> {
  const idempotencyKey = `daily-brief:${args.tenant.tenantId}:${args.snapshotDate}:${args.channel}:${args.recipient}`;
  const advisor = args.brief.advisor as
    | {
        readonly insight: string;
        readonly action: string;
        readonly greetingEn?: string;
        readonly summaryEn?: string;
      }
    | null
    | undefined;
  const summary = advisor?.insight ?? "Today's mining brief is ready.";
  const action = advisor?.action ?? '';
  const subject = `Mr. Mwikila — daily brief for ${args.snapshotDate}`;
  const body = renderBriefBody({
    advisor,
    snapshotDate: args.snapshotDate,
    decisionsCount: args.brief.decisions.pendingCount,
    incidentsCount: args.brief.openHighIncidents.count,
    licencesAtRisk: args.brief.licenceHealth.atRiskCount,
  });

  try {
    if (args.channel === 'email') {
      const res = await args.emailProvider.send({
        tenantId: args.tenant.tenantId,
        recipientAddress: args.recipient,
        templateKey: 'owner.daily_brief',
        locale: 'en',
        payload: {
          subject,
          body,
          summary,
          action,
          snapshotDate: args.snapshotDate,
        },
        idempotencyKey,
      });
      if (res.status === 'sent') {
        return { status: 'sent', providerMessageId: res.providerRef };
      }
      return {
        status: 'failed',
        errorCode: res.errorCode,
        errorMessage: res.errorMessage,
      };
    }

    if (args.channel === 'sms') {
      const res = await args.smsProvider.send({
        tenantId: args.tenant.tenantId,
        recipientAddress: args.recipient,
        templateKey: 'owner.daily_brief',
        locale: 'en',
        payload: { summary, action, snapshotDate: args.snapshotDate },
        idempotencyKey,
        channel: 'sms',
      });
      if (res.status === 'sent') {
        return { status: 'sent', providerMessageId: res.providerRef };
      }
      return {
        status: 'failed',
        errorCode: res.errorCode,
        errorMessage: res.errorMessage,
      };
    }

    // slack
    const webhook =
      args.slackWebhookForTenant?.(args.tenant.tenantId) ??
      process.env.SLACK_WEBHOOK_URL?.trim() ??
      null;
    if (!webhook) {
      return {
        status: 'failed',
        errorCode: 'slack_webhook_not_configured',
        errorMessage: 'no webhook configured for tenant',
      };
    }
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `*Mr. Mwikila — daily brief* (${args.snapshotDate})\n${summary}${action ? `\n_Action:_ ${action}` : ''}`,
        username: 'Mr. Mwikila (Borjie)',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        status: 'failed',
        errorCode: `slack_${res.status}`,
        errorMessage: text.slice(0, 400),
      };
    }
    return { status: 'sent' };
  } catch (err) {
    return {
      status: 'failed',
      errorCode: 'dispatch_threw',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function renderBriefBody(args: {
  readonly advisor:
    | {
        readonly insight: string;
        readonly action: string;
        readonly greetingEn?: string;
        readonly summaryEn?: string;
      }
    | null
    | undefined;
  readonly snapshotDate: string;
  readonly decisionsCount: number;
  readonly incidentsCount: number;
  readonly licencesAtRisk: number;
}): string {
  const lines: string[] = [];
  if (args.advisor) {
    if (args.advisor.greetingEn) {
      lines.push(args.advisor.greetingEn);
      lines.push('');
    }
    if (args.advisor.summaryEn) {
      lines.push(args.advisor.summaryEn);
      lines.push('');
    }
    if (args.advisor.insight) {
      lines.push(`Insight: ${args.advisor.insight}`);
    }
    if (args.advisor.action) {
      lines.push(`Action: ${args.advisor.action}`);
    }
    lines.push('');
  }
  lines.push(`Snapshot for ${args.snapshotDate}`);
  lines.push(`- Decisions awaiting you: ${args.decisionsCount}`);
  lines.push(`- Open high-severity incidents: ${args.incidentsCount}`);
  lines.push(`- Licences at risk: ${args.licencesAtRisk}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Recipient pickers
// ─────────────────────────────────────────────────────────────────────

function pickHandle(
  channel: 'email' | 'sms' | 'slack',
  r: DailyBriefRecipient,
): string | null {
  if (channel === 'email') return r.email?.trim() || null;
  if (channel === 'sms') return r.phone?.trim() || null;
  return r.slackHandle?.trim() || null;
}

function recipientLabel(
  channel: 'email' | 'sms' | 'slack',
  r: DailyBriefRecipient,
): string {
  if (channel === 'email') return r.email ?? r.userId ?? 'unknown';
  if (channel === 'sms') return r.phone ?? r.userId ?? 'unknown';
  return r.slackHandle ?? r.userId ?? 'unknown';
}

// ─────────────────────────────────────────────────────────────────────
// SQL helpers
// ─────────────────────────────────────────────────────────────────────

async function fetchDueTenants(
  db: DbLike,
  now: Date,
  logger: Logger,
): Promise<ReadonlyArray<DueTenant>> {
  try {
    // Read every tenant with a cadence != 'off'. The cron tick fires
    // every 5 min so the per-tenant local-time check is done in JS
    // against the cadence regex — cheap and keeps the SQL portable
    // across timezones.
    const res = await db.execute(sql`
      SELECT id::text                 AS tenant_id,
             daily_brief_cadence      AS cadence,
             daily_brief_channels     AS channels,
             daily_brief_recipients   AS recipients,
             COALESCE(timezone, ${DEFAULT_TZ}) AS tz
        FROM tenants
       WHERE status = 'active'
         AND daily_brief_cadence <> 'off'
         AND daily_brief_recipients IS NOT NULL
         AND jsonb_array_length(daily_brief_recipients) > 0
       LIMIT 1000
    `);
    const rows = rowsOf(res);
    const out: DueTenant[] = [];
    for (const r of rows) {
      const tenantId = String((r as Record<string, unknown>).tenant_id ?? '');
      if (!tenantId) continue;
      const cadence = String((r as Record<string, unknown>).cadence ?? '');
      const tz =
        String((r as Record<string, unknown>).tz ?? DEFAULT_TZ) ||
        DEFAULT_TZ;
      if (!isDueNow(cadence, now, tz)) continue;
      // De-dupe: skip tenants that already received TODAY's email run
      // (cheap presence check; per-channel idempotency is enforced in
      // the dispatch ledger).
      const today = isoDateInTz(now, tz);
      const already = await alreadyHasDispatchToday(db, tenantId, today);
      if (already) continue;
      out.push({
        tenantId,
        cadence,
        channels: normaliseChannels(
          (r as Record<string, unknown>).channels,
        ),
        recipients: normaliseRecipients(
          (r as Record<string, unknown>).recipients,
        ),
        localTimezone: tz,
      });
    }
    return out;
  } catch (err) {
    logger.warn(
      {
        worker: 'daily-brief-cron',
        err: err instanceof Error ? err.message : String(err),
      },
      'daily-brief-cron: due-tenant scan failed',
    );
    return [];
  }
}

async function fetchTenantPrefs(
  db: DbLike,
  tenantId: string,
  logger: Logger,
): Promise<DueTenant | null> {
  try {
    const res = await db.execute(sql`
      SELECT id::text                 AS tenant_id,
             daily_brief_cadence      AS cadence,
             daily_brief_channels     AS channels,
             daily_brief_recipients   AS recipients,
             COALESCE(timezone, ${DEFAULT_TZ}) AS tz
        FROM tenants
       WHERE id::text = ${tenantId}
       LIMIT 1
    `);
    const rows = rowsOf(res);
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      tenantId: String(r.tenant_id ?? tenantId),
      cadence: String(r.cadence ?? 'off'),
      channels: normaliseChannels(r.channels),
      recipients: normaliseRecipients(r.recipients),
      localTimezone: String(r.tz ?? DEFAULT_TZ) || DEFAULT_TZ,
    };
  } catch (err) {
    logger.warn(
      {
        worker: 'daily-brief-cron',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'daily-brief-cron: fetch tenant prefs failed',
    );
    return null;
  }
}

async function alreadyHasDispatchToday(
  db: DbLike,
  tenantId: string,
  snapshotDate: string,
): Promise<boolean> {
  try {
    const res = await db.execute(sql`
      SELECT 1
        FROM daily_brief_dispatches
       WHERE tenant_id = ${tenantId}::uuid
         AND snapshot_date = ${snapshotDate}::date
         AND status = 'sent'
       LIMIT 1
    `);
    return rowsOf(res).length > 0;
  } catch {
    return false;
  }
}

async function claimDispatchRow(args: {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly tenantId: string;
  readonly snapshotDate: string;
  readonly channel: 'email' | 'sms' | 'slack';
  readonly recipient: string;
}): Promise<{ readonly id: string } | null> {
  try {
    const res = await args.db.execute(sql`
      INSERT INTO daily_brief_dispatches
        (id, tenant_id, snapshot_date, channel, recipient, status)
      VALUES
        (${randomUUID()}::uuid,
         ${args.tenantId}::uuid,
         ${args.snapshotDate}::date,
         ${args.channel},
         ${args.recipient},
         'sent')
      ON CONFLICT (tenant_id, snapshot_date, channel, recipient)
      DO NOTHING
      RETURNING id::text
    `);
    const rows = rowsOf(res);
    if (rows.length === 0) return null;
    return { id: String((rows[0] as Record<string, unknown>).id ?? '') };
  } catch (err) {
    args.logger.warn(
      {
        worker: 'daily-brief-cron',
        tenantId: args.tenantId,
        channel: args.channel,
        err: err instanceof Error ? err.message : String(err),
      },
      'daily-brief-cron: claim dispatch failed',
    );
    return null;
  }
}

async function finaliseDispatch(args: {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly dispatchId: string;
  readonly tenantId: string;
  readonly snapshotDate: string;
  readonly channel: 'email' | 'sms' | 'slack';
  readonly recipient: string;
  readonly result: DispatchResult;
}): Promise<void> {
  try {
    await args.db.execute(sql`
      UPDATE daily_brief_dispatches
         SET status              = ${args.result.status},
             provider_message_id = ${args.result.providerMessageId ?? null},
             error_code          = ${args.result.errorCode ?? null},
             error_message       = ${args.result.errorMessage ?? null},
             dispatched_at       = now()
       WHERE id = ${args.dispatchId}::uuid
    `);
  } catch (err) {
    args.logger.warn(
      {
        worker: 'daily-brief-cron',
        dispatchId: args.dispatchId,
        err: err instanceof Error ? err.message : String(err),
      },
      'daily-brief-cron: finalise dispatch failed',
    );
  }
  // Best-effort audit chain append — never blocks delivery.
  await appendDispatchAuditEntry(args).catch((err) => {
    args.logger.warn(
      {
        worker: 'daily-brief-cron',
        dispatchId: args.dispatchId,
        err: err instanceof Error ? err.message : String(err),
      },
      'daily-brief-cron: audit append failed',
    );
  });
}

async function appendDispatchAuditEntry(args: {
  readonly db: DbLike;
  readonly tenantId: string;
  readonly snapshotDate: string;
  readonly channel: 'email' | 'sms' | 'slack';
  readonly recipient: string;
  readonly dispatchId: string;
  readonly result: DispatchResult;
}): Promise<void> {
  const id = randomUUID();
  const turnId = `daily-brief-${args.snapshotDate}-${args.channel}`;
  const payload = JSON.stringify({
    dispatchId: args.dispatchId,
    channel: args.channel,
    recipient: args.recipient,
    status: args.result.status,
    providerMessageId: args.result.providerMessageId ?? null,
  });
  await args.db.execute(sql`
    WITH prev AS (
      SELECT this_hash, sequence_id
        FROM ai_audit_chain
       WHERE tenant_id = ${args.tenantId}
       ORDER BY sequence_id DESC
       LIMIT 1
    )
    INSERT INTO ai_audit_chain
      (id, tenant_id, sequence_id, turn_id, session_id, action,
       prev_hash, this_hash, payload_ref, payload, created_at)
    VALUES (
      ${id},
      ${args.tenantId},
      COALESCE((SELECT sequence_id FROM prev), 0) + 1,
      ${turnId},
      NULL,
      ${`owner.daily_brief.dispatch.${args.result.status}`},
      COALESCE((SELECT this_hash FROM prev), ''),
      encode(sha256(
        (COALESCE((SELECT this_hash FROM prev), '') || ${payload})::bytea
      ), 'hex'),
      NULL,
      ${payload}::jsonb,
      now()
    )
  `);
  // Link the dispatch row back to its audit entry.
  await args.db.execute(sql`
    UPDATE daily_brief_dispatches
       SET hash_chain_id = ${id}::uuid
     WHERE id = ${args.dispatchId}::uuid
  `);
}

async function recordDispatch(args: {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly tenantId: string;
  readonly snapshotDate: string;
  readonly channel: 'email' | 'sms' | 'slack';
  readonly recipient: string;
  readonly status: 'sent' | 'failed' | 'skipped';
  readonly errorCode?: string;
  readonly errorMessage?: string;
}): Promise<void> {
  try {
    await args.db.execute(sql`
      INSERT INTO daily_brief_dispatches
        (id, tenant_id, snapshot_date, channel, recipient, status, error_code, error_message)
      VALUES
        (${randomUUID()}::uuid,
         ${args.tenantId}::uuid,
         ${args.snapshotDate}::date,
         ${args.channel},
         ${args.recipient},
         ${args.status},
         ${args.errorCode ?? null},
         ${args.errorMessage ?? null})
      ON CONFLICT (tenant_id, snapshot_date, channel, recipient)
      DO NOTHING
    `);
  } catch (err) {
    args.logger.warn(
      {
        worker: 'daily-brief-cron',
        tenantId: args.tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'daily-brief-cron: record-dispatch insert failed',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Cadence + timezone helpers
// ─────────────────────────────────────────────────────────────────────

const CADENCE_REGEX = /^daily_(\d{2}):(\d{2})_tz$/;

/**
 * Returns true if the cadence's HH:MM falls within the current 5-minute
 * tick window in the tenant's local timezone. The cron ticks every 5
 * min so a one-window match gives us a single fire per day.
 */
export function isDueNow(
  cadence: string,
  now: Date,
  timezone: string,
): boolean {
  const m = CADENCE_REGEX.exec(cadence);
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return false;
  const { hour, minute } = clockInTimezone(now, timezone);
  const cadenceMinutes = hh * 60 + mm;
  const nowMinutes = hour * 60 + minute;
  // Fires within a 5-minute window starting at the cadence time. Tick
  // cadence is 5 min so we never miss the moment, never double-fire
  // (idempotency ledger protects against the double-fire boundary).
  const diff = nowMinutes - cadenceMinutes;
  return diff >= 0 && diff < 5;
}

function clockInTimezone(
  now: Date,
  timezone: string,
): { readonly hour: number; readonly minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const hour = Number(
      parts.find((p) => p.type === 'hour')?.value ?? '0',
    );
    const minute = Number(
      parts.find((p) => p.type === 'minute')?.value ?? '0',
    );
    return { hour, minute };
  } catch {
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

function hourInTimezone(now: Date, timezone: string): number {
  return clockInTimezone(now, timezone).hour;
}

function isoDateInTz(now: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────

function normaliseChannels(
  raw: unknown,
): ReadonlyArray<'email' | 'sms' | 'slack'> {
  if (!Array.isArray(raw)) return ['email'];
  const out: Array<'email' | 'sms' | 'slack'> = [];
  for (const item of raw) {
    if (item === 'email' || item === 'sms' || item === 'slack') {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out.length > 0 ? out : ['email'];
}

function normaliseRecipients(raw: unknown): ReadonlyArray<DailyBriefRecipient> {
  if (!Array.isArray(raw)) return [];
  const out: DailyBriefRecipient[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const entry: DailyBriefRecipient = {
      ...(typeof r.userId === 'string' ? { userId: r.userId } : {}),
      ...(typeof r.email === 'string' ? { email: r.email } : {}),
      ...(typeof r.phone === 'string' ? { phone: r.phone } : {}),
      ...(typeof r.slackHandle === 'string'
        ? { slackHandle: r.slackHandle }
        : {}),
    };
    if (entry.email || entry.phone || entry.slackHandle) {
      out.push(entry);
    }
  }
  return out;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = (result as { rows?: unknown }).rows;
  return Array.isArray(wrapped)
    ? (wrapped as ReadonlyArray<Record<string, unknown>>)
    : [];
}
