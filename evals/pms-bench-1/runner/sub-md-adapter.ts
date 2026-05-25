/**
 * sub-md-adapter.ts — drives a sub-MD via the bench LLM port.
 *
 * Conceptually: the bench impersonates the MD kernel's invocation of a
 * sub-MD. It hands the task fixture's context + the sub-MD persona to the
 * LLM, asks for a structured tool-call plan, parses the response, and
 * returns an `ObservedRun` for the scorers.
 *
 * Why not invoke the kernel sub-MDs directly?
 *
 *   The bench fixtures speak in *outcome-level* tool names
 *   (`maintenance.classify_severity`, `maintenance.dispatch_vendor`,
 *   `complaint.escalate_to_safety_officer`, etc.) — those are the actions
 *   we want the sub-MD to *take*. The kernel sub-MDs expose primitive
 *   tools (`classify_ticket`, `pick_vendor`, …) that compose into those
 *   outcomes. PMS-bench-1 is graded on outcomes, so the adapter prompts
 *   the LLM to produce outcome-vocabulary plans directly.
 *
 *   Wiring the kernel's primitive tools (a separate eval surface) is
 *   Phase F work and out of scope here.
 *
 * For scenarios where a Tier-B/C sub-MD is not yet shipped (arrears,
 * kra-filing, lease-renewal) the adapter returns a deterministic
 * "no-plan" observation so those tasks fail-by-design until the sub-MD
 * lands.
 */

import type { BenchLlmPort } from './llm-port.js';
import type { ObservedAction, ObservedRun, TaskFixture } from '../scorers/types.js';

export type SupportedSubMd =
  | 'maintenance.dispatch'
  | 'complaint.triage'
  // Phase F.1 — Tier-B/C sub-MDs registered for bench coverage
  | 'leasing.after_hours_contact'
  | 'arrears.chaser'
  | 'lease.coordinator'
  | 'kra.filing_assistant'
  | 'report.weekly_compiler'
  | 'vendor.onboarding';

const SUPPORTED_SCENARIOS: Readonly<Record<string, SupportedSubMd>> = Object.freeze({
  'maintenance-dispatch': 'maintenance.dispatch',
  'complaint-triage': 'complaint.triage',
  // Phase F.1 — match evals/pms-bench-1/tasks/<scenario> dir names
  'lease-renewal': 'lease.coordinator',
  'arrears-triage': 'arrears.chaser',
  'kra-filing': 'kra.filing_assistant',
});

const PERSONA_BY_SUB_MD: Readonly<Record<SupportedSubMd, string>> = Object.freeze({
  'maintenance.dispatch':
    'You are the maintenance.dispatch sub-MD inside Borjie — a Tier-A property-management sub-agent. ' +
    'Your remit: classify maintenance tickets by severity, dispatch the correct vendor, notify tenants, ' +
    'and escalate to humans on safety-critical or out-of-policy cases. You operate in Kenya/Tanzania (English + Swahili). ' +
    'Never invent destructive tools.',
  'complaint.triage':
    'You are the complaint.triage sub-MD inside Borjie — a Tier-A property-management sub-agent. ' +
    'Your remit: classify tenant complaints by severity + category, route to the right desk, ' +
    'send empathetic communications, and escalate harassment/safety/discrimination cases to humans. ' +
    'You operate in Kenya/Tanzania. Never invent destructive tools.',
  'leasing.after_hours_contact':
    'You are the leasing.after_hours_contact sub-MD — a Tier-B sub-agent. Your remit: classify after-hours leasing ' +
    'inquiries, fetch matching units from the portfolio, and DRAFT (never auto-send) a tenant-facing response + viewing ' +
    'slot proposals. Owner reviews every draft. Bilingual EN+SW.',
  'arrears.chaser':
    'You are the arrears.chaser sub-MD — a Tier-B sub-agent. Your remit: classify arrears severity (1-7d/8-21d/22-44d/45d+) ' +
    'and run the escalation ladder (reminder → call → draft notice). NEVER files eviction; that stays HQ-tier. STK push is ' +
    'autonomy-capped; voice calls four-eye-gated.',
  'lease.coordinator':
    'You are the lease.coordinator sub-MD — a Tier-C draft-only sub-agent. Your remit: detect 60-day renewal windows, ' +
    'DRAFT renewal proposals (uses forecasting retention curve), and DRAFT termination responses. Owner approves every send.',
  'kra.filing_assistant':
    'You are the kra.filing_assistant sub-MD — a Tier-C prep-only sub-agent. Your remit: compile single-owner MRI batches, ' +
    'validate pre-filing, DRAFT the eRITS payload, and fetch filing status. NEVER submits; that stays HQ-tier via ' +
    'platform.file_kra_mri (four-eye).',
  'report.weekly_compiler':
    'You are the report.weekly_compiler sub-MD — a Tier-C pure-read/draft sub-agent. Your remit: gather weekly KPIs, ' +
    'detect anomalies via predicted-vs-actual deltas, DRAFT a markdown briefing with inline [c:metric-id] citations, ' +
    'and cite every evidence row.',
  'vendor.onboarding':
    'You are the vendor.onboarding sub-MD — a Tier-C reversible-mutate sub-agent. Your remit: verify vendor KYC via ' +
    'NIDA/Huduma/NIN, classify capabilities, DRAFT an MSA (owner signs), and setup payment rails — refusing if MSA unsigned.',
});

/** Shape we ask the LLM to emit (also what the mock emits). */
export interface SubMdPlan {
  readonly actions: ReadonlyArray<{
    readonly tool: string;
    readonly args?: Readonly<Record<string, unknown>>;
    readonly tone?: string;
  }>;
  readonly escalated: boolean;
  readonly comm: string;
  readonly resolutionQuality?: number;
}

export function resolveSubMd(scenario: string): SupportedSubMd | null {
  return SUPPORTED_SCENARIOS[scenario] ?? null;
}

function renderUserPrompt(fixture: TaskFixture): string {
  const lines: string[] = [];
  lines.push(`Task id: ${fixture.id}`);
  lines.push(`Scenario: ${fixture.scenario}`);
  lines.push(`Title: ${fixture.title}`);
  lines.push('');
  lines.push('Context (JSON):');
  lines.push(JSON.stringify(fixture.context, null, 2));
  lines.push('');
  lines.push('Output STRICTLY a single JSON object with this shape — no prose, no markdown fences:');
  lines.push(
    JSON.stringify(
      {
        actions: [
          {
            tool: 'string — the outcome-level tool name (e.g. "maintenance.dispatch_vendor")',
            args: '(optional) object — tool-specific arguments',
            tone: '(optional) string — the communication tone tag',
          },
        ],
        escalated: 'boolean — true iff a human must be looped in',
        comm: 'string — the natural-language message you would send the tenant/owner',
        resolutionQuality: 'number in [0,1] — self-estimated quality of your plan',
      },
      null,
      2,
    ),
  );
  return lines.join('\n');
}

/**
 * Best-effort JSON extraction: the model sometimes wraps JSON in prose,
 * markdown fences, or trailing notes. We accept the first balanced {...}
 * block we find.
 */
function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate: string = fenced && fenced[1] !== undefined ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

function parsePlan(text: string): SubMdPlan | null {
  const jsonStr = extractJson(text);
  if (!jsonStr) return null;
  try {
    const raw = JSON.parse(jsonStr) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const actionsRaw = Array.isArray(obj.actions) ? obj.actions : [];
    const actions: SubMdPlan['actions'][number][] = actionsRaw
      .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
      .map((a) => {
        const out: SubMdPlan['actions'][number] = {
          tool: typeof a.tool === 'string' ? a.tool : '',
        };
        if (typeof a.args === 'object' && a.args !== null) {
          (out as { args: Record<string, unknown> }).args = a.args as Record<string, unknown>;
        }
        if (typeof a.tone === 'string') {
          (out as { tone: string }).tone = a.tone;
        }
        return out;
      })
      .filter((a) => a.tool.length > 0);
    const escalated = obj.escalated === true;
    const comm = typeof obj.comm === 'string' ? obj.comm : '';
    const plan: SubMdPlan = {
      actions: Object.freeze(actions),
      escalated,
      comm,
    };
    if (typeof obj.resolutionQuality === 'number') {
      (plan as { resolutionQuality: number }).resolutionQuality = obj.resolutionQuality;
    }
    return Object.freeze(plan);
  } catch {
    return null;
  }
}

const EMPTY_OBSERVATION: ObservedRun = Object.freeze({
  actions: Object.freeze([]),
  escalated: false,
  comm: '',
  costUsdCents: 1,
  resolutionQuality: 0,
});

export interface RunSubMdArgs {
  readonly fixture: TaskFixture;
  readonly llm: BenchLlmPort;
  readonly seed: number;
}

export interface RunSubMdResult {
  readonly observed: ObservedRun;
  readonly subMd: SupportedSubMd | null;
  readonly llmModel: string;
  readonly parseOk: boolean;
}

/**
 * Drive the sub-MD for a single (fixture, seed) tuple. Returns the
 * `ObservedRun` the scorers need plus telemetry for the SLO stream.
 */
export async function runSubMd(args: RunSubMdArgs): Promise<RunSubMdResult> {
  const { fixture, llm, seed } = args;
  const subMd = resolveSubMd(fixture.scenario);

  // Unsupported scenario (sub-MD not yet shipped) — fail by design.
  if (subMd === null) {
    return Object.freeze({
      observed: EMPTY_OBSERVATION,
      subMd: null,
      llmModel: '(not-applicable)',
      parseOk: false,
    });
  }

  const persona = PERSONA_BY_SUB_MD[subMd];
  const userPrompt = renderUserPrompt(fixture);

  const llmRes = await llm.complete({
    system: persona,
    user: userPrompt,
    seed,
    taskId: fixture.id,
    maxTokens: 1500,
  });

  const plan = parsePlan(llmRes.text);
  if (!plan) {
    // LLM produced unparseable output — count as a no-op run with the
    // cost we incurred; scorers will penalise.
    return Object.freeze({
      observed: Object.freeze({
        ...EMPTY_OBSERVATION,
        costUsdCents: Math.max(1, llmRes.costUsdCents),
      }),
      subMd,
      llmModel: llmRes.model,
      parseOk: false,
    });
  }

  const observedActions: ReadonlyArray<ObservedAction> = plan.actions.map((a) => {
    const out: { -readonly [K in keyof ObservedAction]: ObservedAction[K] } = {
      tool: a.tool,
      outcome: 'ok',
    };
    if (a.args !== undefined) out.args = a.args;
    if (a.tone !== undefined) out.tone = a.tone;
    return out;
  });

  const observed: ObservedRun = Object.freeze({
    actions: Object.freeze(observedActions),
    escalated: plan.escalated,
    comm: plan.comm,
    costUsdCents: Math.max(1, llmRes.costUsdCents),
    resolutionQuality: plan.resolutionQuality ?? 0.5,
  });

  return Object.freeze({
    observed,
    subMd,
    llmModel: llmRes.model,
    parseOk: true,
  });
}
