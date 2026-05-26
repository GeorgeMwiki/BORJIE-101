/**
 * Proposal generator — turns failing signals + the current FormSchema
 * into a structured `ProposedDiff` ready for owner review.
 *
 * Two modes:
 *
 *   1. `mode = 'llm'` — uses a `BrainLLMClient` from
 *      `@borjie/brain-llm-router` (Haiku → Sonnet cost cascade) to
 *      draft natural-language reasoning + a typed list of diff ops.
 *      The LLM is bounded structurally: we expose a strict response
 *      schema so it can only return Tier-1 ops (reorder, regroup,
 *      split step, add help copy, rename label). Anything else is
 *      dropped at parse time.
 *
 *   2. `mode = 'stub'` — used in tests + when UI_EVO_DISABLE_LLM is
 *      set. The stub generates a deterministic proposal from the
 *      first 1-2 failing signals: it adds help copy citing the
 *      corpus rule for any field with high tooltip-hit, and reorders
 *      problem fields after the high-completion ones.
 *
 * In both modes the output goes through `proposal-validator` before
 * the proposal-emitter writes it — Tier-2 ops (submit-action change,
 * required-field change, brand surface) are rejected upstream.
 */

import type {
  BrainLLMClient,
  BrainLLMResponse,
} from '@borjie/brain-llm-router';
import type { FormSchema } from '@borjie/dynamic-ui';
import type {
  FailingSignal,
  ProposedDiff,
  ProposedDiffOp,
  TabRecipeRow,
} from '../types.js';

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface GenerateProposalArgs {
  readonly recipe: TabRecipeRow;
  readonly currentSchema: FormSchema;
  readonly failingSignals: ReadonlyArray<FailingSignal>;
  /** Corpus citations the worker already knows the failing fields map
   *  to — fed straight into the LLM prompt + carried into the
   *  proposal.citations column. */
  readonly knownCitations: ReadonlyArray<string>;
  readonly mode: 'llm' | 'stub';
  /** Wire only required when mode === 'llm'. */
  readonly llmClient?: BrainLLMClient;
  readonly model?: string;
}

export interface GeneratedProposal {
  readonly diff: ProposedDiff;
  readonly citations: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Stub mode — deterministic, no I/O.
// ---------------------------------------------------------------------------

export function generateStubProposal(args: {
  readonly recipe: TabRecipeRow;
  readonly currentSchema: FormSchema;
  readonly failingSignals: ReadonlyArray<FailingSignal>;
  readonly knownCitations: ReadonlyArray<string>;
}): GeneratedProposal {
  const ops: ProposedDiffOp[] = [];

  for (const signal of args.failingSignals) {
    if (signal.kind === 'high_tooltip_hit' && signal.fieldId) {
      const citation = args.knownCitations[0] ?? 'TUMEMADINI-UNKNOWN';
      ops.push({
        op: 'add_help_copy',
        fieldId: signal.fieldId,
        helpEn: `Add inline help text explaining ${signal.fieldId}.`,
        helpSw: `Ongeza maelezo ya papo hapo kuhusu ${signal.fieldId}.`,
        citationId: citation,
      });
    }
    if (signal.kind === 'high_field_error' && signal.fieldId) {
      // Rename the label — gently improving clarity is Tier 1.
      ops.push({
        op: 'rename_label',
        fieldId: signal.fieldId,
        labelEnBefore: signal.fieldId,
        labelEnAfter: `${signal.fieldId} (please double-check)`,
        labelSwBefore: signal.fieldId,
        labelSwAfter: `${signal.fieldId} (tafadhali angalia tena)`,
      });
    }
  }

  // Always include at least one op so the proposal is meaningful.
  if (ops.length === 0 && args.currentSchema.groups[0]?.fields[0]) {
    const firstFieldId = args.currentSchema.groups[0].fields[0].id;
    ops.push({
      op: 'rename_label',
      fieldId: firstFieldId,
      labelEnBefore: args.currentSchema.groups[0].fields[0].label_en,
      labelEnAfter: `${args.currentSchema.groups[0].fields[0].label_en} (clarified)`,
      labelSwBefore: args.currentSchema.groups[0].fields[0].label_sw,
      labelSwAfter: `${args.currentSchema.groups[0].fields[0].label_sw} (yenye ufafanuzi)`,
    });
  }

  return {
    diff: {
      ops,
      rationaleEn: composeStubRationale(args.failingSignals, 'en'),
      rationaleSw: composeStubRationale(args.failingSignals, 'sw'),
    },
    citations: args.knownCitations,
  };
}

function composeStubRationale(
  failing: ReadonlyArray<FailingSignal>,
  locale: 'en' | 'sw',
): string {
  if (failing.length === 0) {
    return locale === 'en'
      ? 'Light-touch clarification pass.'
      : 'Marekebisho madogo ya ufafanuzi.';
  }
  const lead = locale === 'en' ? 'Telemetry signals:' : 'Ishara za matumizi:';
  return `${lead} ${failing.map((s) => s.humanReadable).join(' / ')}`;
}

// ---------------------------------------------------------------------------
// LLM mode — Haiku → Sonnet cost cascade pattern.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Mr. Mwikila, an Anticipatory UX optimizer for the Borjie mining operations platform. You propose Tier-1 dynamic-UI improvements based on telemetry signals. You MUST:

 * Only propose changes from these ops: reorder_fields, regroup_field, split_step, add_help_copy, rename_label.
 * NEVER propose changing submit_action, NEVER change required vs optional, NEVER alter brand surface.
 * Every help_copy MUST cite a corpus citation_id you were given.
 * Respond with JSON ONLY in the schema provided.
 * Provide rationale in both English (rationaleEn) and Swahili (rationaleSw).

Your output JSON shape:
{
  "ops": [...],
  "rationaleEn": "...",
  "rationaleSw": "..."
}`;

export async function generateLlmProposal(args: {
  readonly client: BrainLLMClient;
  readonly model: string;
  readonly recipe: TabRecipeRow;
  readonly currentSchema: FormSchema;
  readonly failingSignals: ReadonlyArray<FailingSignal>;
  readonly knownCitations: ReadonlyArray<string>;
}): Promise<GeneratedProposal> {
  const userPrompt = composeUserPrompt(args);
  const response = await args.client.invoke({
    model: args.model,
    system: SYSTEM_PROMPT,
    maxTokens: 1500,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: userPrompt }],
      },
    ],
  });
  const diff = parseLlmDiff(response, args.failingSignals);
  return {
    diff,
    citations: args.knownCitations,
  };
}

function composeUserPrompt(args: {
  readonly recipe: TabRecipeRow;
  readonly currentSchema: FormSchema;
  readonly failingSignals: ReadonlyArray<FailingSignal>;
  readonly knownCitations: ReadonlyArray<string>;
}): string {
  const failingDescr = args.failingSignals
    .map((s) => `- ${s.humanReadable} (kind=${s.kind}, field=${s.fieldId ?? 'tab'}, value=${s.value.toFixed(2)}, threshold=${s.threshold.toFixed(2)})`)
    .join('\n');
  const citations = args.knownCitations.length > 0
    ? args.knownCitations.join(', ')
    : '(no specific citations supplied)';
  return [
    `Tab Recipe: ${args.recipe.id} (intent=${args.recipe.intent}, version=${args.recipe.version}, authority_tier=${args.recipe.authorityTier})`,
    '',
    'Failing telemetry signals (14-day window):',
    failingDescr,
    '',
    `Known corpus citations: ${citations}`,
    '',
    `Current FormSchema (truncated): ${JSON.stringify({
      title_en: args.currentSchema.title_en,
      groups: args.currentSchema.groups.map((g) => ({
        id: g.id,
        title_en: g.title_en,
        fields: g.fields.map((f) => f.id),
      })),
    })}`,
    '',
    'Propose a Tier-1 improvement that addresses the failing signals. Reply with JSON only.',
  ].join('\n');
}

interface LlmDiffPayload {
  readonly ops?: ReadonlyArray<unknown>;
  readonly rationaleEn?: string;
  readonly rationaleSw?: string;
}

function parseLlmDiff(
  response: BrainLLMResponse,
  failing: ReadonlyArray<FailingSignal>,
): ProposedDiff {
  const text = response.content
    .filter((c) => c.type === 'text')
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n')
    .trim();
  const json = extractJsonObject(text);
  if (!json) {
    // LLM didn't return parseable JSON — fall back to a minimal stub.
    return {
      ops: [],
      rationaleEn: 'LLM did not return a structured diff; flagging for human review.',
      rationaleSw: 'LLM hakurudisha mabadiliko yaliyopangwa; inahitaji ukaguzi wa kibinadamu.',
    };
  }
  const payload = json as LlmDiffPayload;
  const ops: ProposedDiffOp[] = [];
  if (Array.isArray(payload.ops)) {
    for (const rawOp of payload.ops) {
      const parsed = parseDiffOp(rawOp);
      if (parsed) ops.push(parsed);
    }
  }
  return {
    ops,
    rationaleEn:
      typeof payload.rationaleEn === 'string'
        ? payload.rationaleEn
        : `Telemetry: ${failing.map((s) => s.humanReadable).join(' / ')}`,
    rationaleSw:
      typeof payload.rationaleSw === 'string'
        ? payload.rationaleSw
        : 'Mwendelezo wa marekebisho ya UI kulingana na ishara za matumizi.',
  };
}

function extractJsonObject(text: string): unknown | null {
  // Greedy match: find the first { and last } and parse.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  const candidate = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseDiffOp(raw: unknown): ProposedDiffOp | null {
  if (!isObject(raw)) return null;
  const op = raw['op'];
  switch (op) {
    case 'reorder_fields': {
      if (
        typeof raw['groupId'] === 'string' &&
        isStringArray(raw['fieldIdsBefore']) &&
        isStringArray(raw['fieldIdsAfter'])
      ) {
        return {
          op: 'reorder_fields',
          groupId: raw['groupId'],
          fieldIdsBefore: raw['fieldIdsBefore'],
          fieldIdsAfter: raw['fieldIdsAfter'],
        };
      }
      return null;
    }
    case 'regroup_field': {
      if (
        typeof raw['fieldId'] === 'string' &&
        typeof raw['fromGroupId'] === 'string' &&
        typeof raw['toGroupId'] === 'string'
      ) {
        return {
          op: 'regroup_field',
          fieldId: raw['fieldId'],
          fromGroupId: raw['fromGroupId'],
          toGroupId: raw['toGroupId'],
        };
      }
      return null;
    }
    case 'split_step': {
      if (
        typeof raw['groupId'] === 'string' &&
        isStringArray(raw['intoGroupIds'])
      ) {
        return {
          op: 'split_step',
          groupId: raw['groupId'],
          intoGroupIds: raw['intoGroupIds'],
        };
      }
      return null;
    }
    case 'add_help_copy': {
      if (
        typeof raw['fieldId'] === 'string' &&
        typeof raw['helpEn'] === 'string' &&
        typeof raw['helpSw'] === 'string' &&
        typeof raw['citationId'] === 'string'
      ) {
        return {
          op: 'add_help_copy',
          fieldId: raw['fieldId'],
          helpEn: raw['helpEn'],
          helpSw: raw['helpSw'],
          citationId: raw['citationId'],
        };
      }
      return null;
    }
    case 'rename_label': {
      if (
        typeof raw['fieldId'] === 'string' &&
        typeof raw['labelEnBefore'] === 'string' &&
        typeof raw['labelEnAfter'] === 'string' &&
        typeof raw['labelSwBefore'] === 'string' &&
        typeof raw['labelSwAfter'] === 'string'
      ) {
        return {
          op: 'rename_label',
          fieldId: raw['fieldId'],
          labelEnBefore: raw['labelEnBefore'],
          labelEnAfter: raw['labelEnAfter'],
          labelSwBefore: raw['labelSwBefore'],
          labelSwAfter: raw['labelSwAfter'],
        };
      }
      return null;
    }
    default:
      return null; // Tier-2 ops and anything unknown are silently dropped.
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

// ---------------------------------------------------------------------------
// Public entrypoint — dispatches to stub vs LLM.
// ---------------------------------------------------------------------------

export async function generateProposal(
  args: GenerateProposalArgs,
): Promise<GeneratedProposal> {
  if (args.mode === 'stub' || !args.llmClient || !args.model) {
    return generateStubProposal({
      recipe: args.recipe,
      currentSchema: args.currentSchema,
      failingSignals: args.failingSignals,
      knownCitations: args.knownCitations,
    });
  }
  return generateLlmProposal({
    client: args.llmClient,
    model: args.model,
    recipe: args.recipe,
    currentSchema: args.currentSchema,
    failingSignals: args.failingSignals,
    knownCitations: args.knownCitations,
  });
}
