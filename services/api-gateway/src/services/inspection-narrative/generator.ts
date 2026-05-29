/**
 * Inspection-narrative service — closes chain C-C (issue #194).
 *
 * Generates a bilingual sw/en Markdown narrative for a pre-shift
 * inspection (or any inspection table that shares the `(id, tenantId,
 * checklist, evidenceIds)` shape), persists the row in
 * `inspection_narratives`, and owns the state machine:
 *
 *   draft → manager_ok → owner_signed → submitted → delivered.
 *
 * The actual LLM call is injected so the service can run pure-mock in
 * tests; the production `defaultGenerateNarrative` produces a
 * deterministic, evidence-cited narrative from the checklist + notes
 * without making any network calls. A future wave can swap in the
 * real Anthropic/OpenAI client.
 *
 * Per CLAUDE.md:
 *   - Pino logger only.
 *   - Tenant-scoped RLS — caller binds the GUC.
 *   - Audit + cockpit emission on every state transition.
 *   - Swahili-first.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import { inspectionNarratives } from '@borjie/database';
import type {
  InspectionNarrativeRow,
  InspectionNarrativeStatus,
  InspectionNarrativeKind,
  InspectionNarrativeRegulator,
  NewInspectionNarrativeRow,
} from '@borjie/database/schemas';
import { publishCockpitEvent } from '../cockpit-events/bus';

// ---------------------------------------------------------------------------
// State-machine table
// ---------------------------------------------------------------------------

const TRANSITIONS: Readonly<
  Record<InspectionNarrativeStatus, ReadonlySet<InspectionNarrativeStatus>>
> = Object.freeze({
  draft: new Set<InspectionNarrativeStatus>(['manager_ok', 'superseded']),
  manager_ok: new Set<InspectionNarrativeStatus>([
    'owner_signed',
    'superseded',
  ]),
  owner_signed: new Set<InspectionNarrativeStatus>(['submitted', 'superseded']),
  submitted: new Set<InspectionNarrativeStatus>(['delivered']),
  delivered: new Set<InspectionNarrativeStatus>(),
  superseded: new Set<InspectionNarrativeStatus>(),
});

export function canTransitionNarrative(
  from: InspectionNarrativeStatus,
  to: InspectionNarrativeStatus,
): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

export class InspectionNarrativeStateError extends Error {
  readonly code = 'INSPECTION_NARRATIVE_INVALID_TRANSITION';
  constructor(
    readonly from: InspectionNarrativeStatus,
    readonly to: InspectionNarrativeStatus,
  ) {
    super(
      `Invalid inspection-narrative state transition: ${from} → ${to}. ` +
        `See services/api-gateway/src/services/inspection-narrative/generator.ts.`,
    );
  }
}

// ---------------------------------------------------------------------------
// LLM injection seam
// ---------------------------------------------------------------------------

export interface InspectionInputForLlm {
  readonly inspectionId: string;
  readonly inspectionKind: InspectionNarrativeKind;
  readonly siteName?: string | undefined;
  readonly assetName?: string | undefined;
  readonly supervisorName?: string | undefined;
  readonly shiftKind?: 'day' | 'night' | undefined;
  readonly checklist: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly status: 'pass' | 'fail' | 'na';
    readonly note?: string | undefined;
  }>;
  readonly notes?: string | undefined;
  readonly evidenceIds: readonly string[];
  readonly observedAt: Date;
}

export interface GeneratedNarrative {
  readonly draftMdSw: string;
  readonly draftMdEn: string;
  readonly llmProvider: string;
  readonly llmModel: string;
  readonly promptVersion: string;
  readonly costUsd: number;
}

export type GenerateNarrative = (
  input: InspectionInputForLlm,
) => Promise<GeneratedNarrative>;

// ---------------------------------------------------------------------------
// Production-default narrative generator — deterministic, no network.
//
// Produces a bilingual Markdown report with:
//
//   - YAML front-matter (inspection-kind, observed-at, evidence count)
//   - Summary paragraph
//   - Per-finding bullets grouped by pass / fail / N-A
//   - Evidence-ID list (always cited — Auditor Agent rejects empty)
//
// Real LLM wiring can replace this without changing the signature.
// ---------------------------------------------------------------------------

export const defaultGenerateNarrative: GenerateNarrative = async (input) => {
  const observedIso = input.observedAt.toISOString();
  const observedDate = observedIso.slice(0, 10);
  const totalChecks = input.checklist.length;
  const failures = input.checklist.filter((c) => c.status === 'fail');
  const passes = input.checklist.filter((c) => c.status === 'pass');
  const nas = input.checklist.filter((c) => c.status === 'na');
  // Wave ARTIFACT-RICHNESS: emit a `[^cite:<id>]` chip on every
  // evidence pointer so the artifact-richness pipeline produces a
  // superscript chip + a regulator-grade footnotes section when the
  // narrative is rendered to PDF / DOCX / HTML. The list under
  // `## Evidence` mirrors the same ids for legibility.
  const evidenceCiteChips = input.evidenceIds
    .map((id) => `[^cite:${id}]`)
    .join(' ');
  const evidenceList = input.evidenceIds.length
    ? input.evidenceIds.map((id) => `- ${id} [^cite:${id}]`).join('\n')
    : '- (no evidence attached)';

  const frontMatter = [
    '---',
    `inspection_id: ${input.inspectionId}`,
    `inspection_kind: ${input.inspectionKind}`,
    `observed_at: ${observedIso}`,
    `evidence_count: ${input.evidenceIds.length}`,
    `prompt_version: v1`,
    '---',
  ].join('\n');

  const sw = [
    frontMatter,
    '',
    `# Ripoti ya Ukaguzi — ${observedDate}`,
    '',
    `**Aina ya ukaguzi:** ${input.inspectionKind}.`,
    input.siteName ? `**Tovuti:** ${input.siteName}.` : '',
    input.assetName ? `**Kifaa:** ${input.assetName}.` : '',
    input.supervisorName ? `**Msimamizi:** ${input.supervisorName}.` : '',
    input.shiftKind ? `**Zamu:** ${input.shiftKind === 'day' ? 'mchana' : 'usiku'}.` : '',
    '',
    '## Muhtasari',
    '',
    `Vipimo ${totalChecks} vilifanyika: ${passes.length} vimepita, ${failures.length} vimekosa, ${nas.length} havikuhusika.${evidenceCiteChips ? ' ' + evidenceCiteChips : ''}`,
    input.notes ? `\nMaelezo: ${input.notes}` : '',
    '',
    '## Matokeo',
    '',
    failures.length
      ? '### Matatizo yaliyobainika\n' +
        failures
          .map((c) => `- **${c.code}** ${c.label}${c.note ? ` — ${c.note}` : ''}`)
          .join('\n')
      : '### Matatizo yaliyobainika\n- Hakuna.',
    '',
    passes.length
      ? '### Vipimo vilivyofanikiwa\n' +
        passes.map((c) => `- ${c.code} ${c.label}`).join('\n')
      : '',
    '',
    '## Ushahidi',
    '',
    evidenceList,
  ]
    .filter(Boolean)
    .join('\n');

  const en = [
    frontMatter,
    '',
    `# Inspection Report — ${observedDate}`,
    '',
    `**Inspection kind:** ${input.inspectionKind}.`,
    input.siteName ? `**Site:** ${input.siteName}.` : '',
    input.assetName ? `**Asset:** ${input.assetName}.` : '',
    input.supervisorName ? `**Supervisor:** ${input.supervisorName}.` : '',
    input.shiftKind ? `**Shift:** ${input.shiftKind}.` : '',
    '',
    '## Summary',
    '',
    `${totalChecks} checks performed: ${passes.length} passed, ${failures.length} failed, ${nas.length} not applicable.${evidenceCiteChips ? ' ' + evidenceCiteChips : ''}`,
    input.notes ? `\nNotes: ${input.notes}` : '',
    '',
    '## Findings',
    '',
    failures.length
      ? '### Failed items\n' +
        failures
          .map((c) => `- **${c.code}** ${c.label}${c.note ? ` — ${c.note}` : ''}`)
          .join('\n')
      : '### Failed items\n- None.',
    '',
    passes.length
      ? '### Passed items\n' +
        passes.map((c) => `- ${c.code} ${c.label}`).join('\n')
      : '',
    '',
    '## Evidence',
    '',
    evidenceList,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    draftMdSw: sw,
    draftMdEn: en,
    llmProvider: 'borjie-default',
    llmModel: 'narrative-template-v1',
    promptVersion: 'v1',
    costUsd: 0,
  };
};

// ---------------------------------------------------------------------------
// Service surface
// ---------------------------------------------------------------------------

export interface DbLike {
  insert(table: unknown): {
    values(row: unknown): { returning(): Promise<readonly unknown[]> };
  };
  select(): {
    from(table: unknown): {
      where(predicate: unknown): {
        orderBy?: (col: unknown) => { limit(n: number): Promise<readonly unknown[]> };
        limit(n: number): Promise<readonly unknown[]>;
      };
    };
  };
  update(table: unknown): {
    set(patch: unknown): {
      where(predicate: unknown): { returning(): Promise<readonly unknown[]> };
    };
  };
}

export interface AuditEntryInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly subjectId: string;
  readonly payload: Record<string, unknown>;
}

export interface AuditSink {
  append(entry: AuditEntryInput): Promise<{ sequenceNumber: number }>;
}

export interface InspectionNarrativeServiceDeps {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly auditSink?: AuditSink | undefined;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly generate?: GenerateNarrative | undefined;
}

export interface CreateNarrativeInput {
  readonly tenantId: string;
  readonly inspectionId: string;
  readonly inspectionKind: InspectionNarrativeKind;
  readonly actorId: string;
  readonly llm: InspectionInputForLlm;
}

export interface SignInput {
  readonly tenantId: string;
  readonly narrativeId: string;
  readonly actorId: string;
  readonly canonicalPdfSha256: string;
}

export interface SubmitToRegulatorInput {
  readonly tenantId: string;
  readonly narrativeId: string;
  readonly actorId: string;
  readonly regulator: InspectionNarrativeRegulator;
  readonly regulatorRef?: string | undefined;
}

export class InspectionNarrativeService {
  private readonly db: DbLike;
  private readonly logger: Logger;
  private readonly auditSink: AuditSink | undefined;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly generate: GenerateNarrative;

  constructor(deps: InspectionNarrativeServiceDeps) {
    this.db = deps.db;
    this.logger = deps.logger;
    this.auditSink = deps.auditSink;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => `nar_${randomUUID()}`);
    this.generate = deps.generate ?? defaultGenerateNarrative;
  }

  async listForInspection(
    tenantId: string,
    inspectionId: string,
  ): Promise<ReadonlyArray<InspectionNarrativeRow>> {
    const rows = (await this.db
      .select()
      .from(inspectionNarratives as unknown as object)
      .where(
        and(
          eq(inspectionNarratives.tenantId, tenantId),
          eq(inspectionNarratives.inspectionId, inspectionId),
        ),
      )
      .limit(50)) as readonly InspectionNarrativeRow[];
    return rows;
  }

  async byId(
    tenantId: string,
    narrativeId: string,
  ): Promise<InspectionNarrativeRow | null> {
    const rows = (await this.db
      .select()
      .from(inspectionNarratives as unknown as object)
      .where(
        and(
          eq(inspectionNarratives.tenantId, tenantId),
          eq(inspectionNarratives.id, narrativeId),
        ),
      )
      .limit(1)) as readonly InspectionNarrativeRow[];
    return rows[0] ?? null;
  }

  async generateForInspection(
    input: CreateNarrativeInput,
  ): Promise<InspectionNarrativeRow> {
    const generated = await this.generate(input.llm);
    const id = this.newId();
    const now = this.now();
    const row: NewInspectionNarrativeRow = {
      id,
      tenantId: input.tenantId,
      inspectionId: input.inspectionId,
      inspectionKind: input.inspectionKind,
      status: 'draft',
      draftMdSw: generated.draftMdSw,
      draftMdEn: generated.draftMdEn,
      llmProvider: generated.llmProvider,
      llmModel: generated.llmModel,
      promptVersion: generated.promptVersion,
      costUsd: String(generated.costUsd) as unknown as string,
      generatedAt: now,
      managerOkAt: null,
      managerOkBy: null,
      ownerSignedAt: null,
      ownerSignedBy: null,
      ownerSigSha256: null,
      regulatorSentAt: null,
      regulator: null,
      regulatorRef: null,
      auditChainSeq: null,
      managerNotes: null,
      supersededById: null,
      createdBy: input.actorId,
    };

    const returned = (await this.db
      .insert(inspectionNarratives as unknown as object)
      .values(row)
      .returning()) as readonly InspectionNarrativeRow[];
    const persisted =
      returned[0] ?? (row as unknown as InspectionNarrativeRow);

    await this.audit({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'inspection.narrative.generate',
      subjectId: id,
      payload: {
        inspectionId: input.inspectionId,
        llmProvider: generated.llmProvider,
        costUsd: generated.costUsd,
      },
    });

    publishCockpitEvent({
      kind: 'inspection.narrative_status_changed',
      tenantId: input.tenantId,
      emittedAt: now.toISOString(),
      narrativeId: id,
      inspectionId: input.inspectionId,
      fromStatus: '(new)',
      toStatus: 'draft',
      actorId: input.actorId,
    });

    return persisted;
  }

  async managerApprove(
    tenantId: string,
    narrativeId: string,
    actorId: string,
    notes?: string,
  ): Promise<InspectionNarrativeRow> {
    return this.transition({
      tenantId,
      narrativeId,
      to: 'manager_ok',
      actorId,
      patch: {
        managerOkAt: this.now(),
        managerOkBy: actorId,
        managerNotes: notes ?? null,
      },
    });
  }

  async ownerSign(input: SignInput): Promise<InspectionNarrativeRow> {
    return this.transition({
      tenantId: input.tenantId,
      narrativeId: input.narrativeId,
      to: 'owner_signed',
      actorId: input.actorId,
      patch: {
        ownerSignedAt: this.now(),
        ownerSignedBy: input.actorId,
        ownerSigSha256: input.canonicalPdfSha256,
      },
    });
  }

  async submitToRegulator(
    input: SubmitToRegulatorInput,
  ): Promise<InspectionNarrativeRow> {
    return this.transition({
      tenantId: input.tenantId,
      narrativeId: input.narrativeId,
      to: 'submitted',
      actorId: input.actorId,
      patch: {
        regulatorSentAt: this.now(),
        regulator: input.regulator,
        regulatorRef: input.regulatorRef ?? null,
      },
    });
  }

  async markDelivered(
    tenantId: string,
    narrativeId: string,
    actorId: string,
  ): Promise<InspectionNarrativeRow> {
    return this.transition({
      tenantId,
      narrativeId,
      to: 'delivered',
      actorId,
      patch: {},
    });
  }

  private async transition(args: {
    readonly tenantId: string;
    readonly narrativeId: string;
    readonly to: InspectionNarrativeStatus;
    readonly actorId: string;
    readonly patch: Record<string, unknown>;
  }): Promise<InspectionNarrativeRow> {
    const current = await this.byId(args.tenantId, args.narrativeId);
    if (!current) {
      throw new Error(
        `inspection_narrative ${args.narrativeId} not found for tenant ${args.tenantId}`,
      );
    }
    const fromStatus = current.status as InspectionNarrativeStatus;
    if (!canTransitionNarrative(fromStatus, args.to)) {
      throw new InspectionNarrativeStateError(fromStatus, args.to);
    }

    const auditSeq = await this.auditSafe({
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: `inspection.narrative.transition.${args.to}`,
      subjectId: args.narrativeId,
      payload: { from: fromStatus, to: args.to },
    });

    const patch: Record<string, unknown> = {
      ...args.patch,
      status: args.to,
      updatedAt: this.now(),
    };
    if (current.auditChainSeq == null && auditSeq != null) {
      patch.auditChainSeq = auditSeq;
    }

    const updated = (await this.db
      .update(inspectionNarratives as unknown as object)
      .set(patch)
      .where(
        and(
          eq(inspectionNarratives.tenantId, args.tenantId),
          eq(inspectionNarratives.id, args.narrativeId),
        ),
      )
      .returning()) as readonly InspectionNarrativeRow[];

    const next = updated[0] ?? ({ ...current, ...patch } as InspectionNarrativeRow);

    publishCockpitEvent({
      kind: 'inspection.narrative_status_changed',
      tenantId: args.tenantId,
      emittedAt: new Date().toISOString(),
      narrativeId: args.narrativeId,
      inspectionId: current.inspectionId,
      fromStatus,
      toStatus: args.to,
      actorId: args.actorId,
    });

    return next;
  }

  private async audit(entry: AuditEntryInput): Promise<void> {
    if (!this.auditSink) return;
    try {
      await this.auditSink.append(entry);
    } catch (err) {
      this.logger.warn(
        { err, entry: { action: entry.action, subjectId: entry.subjectId } },
        'inspection-narrative audit append failed',
      );
    }
  }

  private async auditSafe(
    entry: AuditEntryInput,
  ): Promise<number | null> {
    if (!this.auditSink) return null;
    try {
      const { sequenceNumber } = await this.auditSink.append(entry);
      return sequenceNumber;
    } catch (err) {
      this.logger.warn(
        { err, entry: { action: entry.action, subjectId: entry.subjectId } },
        'inspection-narrative audit append failed',
      );
      return null;
    }
  }
}

// Reserve raw helpers for future expansion (e.g. ordering by generatedAt).
void desc;
