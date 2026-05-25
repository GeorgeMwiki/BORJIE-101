/**
 * Plan persistence — Plandex-style multi-step plan.
 *
 * Plans live in `<repo>/.agent-plans/<id>/PLAN.md` and are
 * round-trippable Markdown with YAML frontmatter. The on-disk
 * format is intentionally human-editable:
 *
 *   ---
 *   id: <uuid>
 *   goal: "Implement multi-currency tenant settings"
 *   createdAt: 1716552000000
 *   updatedAt: 1716552500000
 *   version: 2
 *   ---
 *
 *   ## step:s1 — Add currency_preferences table
 *
 *   status: done
 *   dependsOn: []
 *   expectedOutput: A new migration file applied.
 *
 *   <free-form description>
 *
 *   ## step:s2 — Wire UI selector
 *
 *   status: pending
 *   dependsOn: [s1]
 *   ...
 *
 * `createPlan` uses the brain to decompose a goal into steps,
 * `persistPlan` writes the markdown, `loadPlan` parses it back
 * (resumable from any point), `executeStep` runs one step
 * atomically and records a checkpoint.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  BrainPort,
  Plan,
  PlanCheckpoint,
  PlanStep,
  PlanStepStatus,
  RuntimeLogger,
  SandboxPort,
} from '../types.js';
import { noopLogger } from '../types.js';

// ─────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────

export interface CreatePlanOptions {
  readonly goal: string;
  readonly brain: BrainPort;
  readonly maxSteps?: number;
  /**
   * Inject a deterministic ID for tests; otherwise a UUID is used.
   */
  readonly id?: string;
  /**
   * Override the prompt template that asks the brain to decompose
   * the goal. Default works for most goals.
   */
  readonly promptBuilder?: (goal: string, maxSteps: number) => string;
}

const DEFAULT_MAX_STEPS = 10;

export async function createPlan(options: CreatePlanOptions): Promise<Plan> {
  const max = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const prompt =
    options.promptBuilder?.(options.goal, max) ?? defaultPlanPrompt(options.goal, max);
  const res = await options.brain.generate({ prompt });
  const steps = parseBrainStepList(res.text);
  const now = Date.now();
  return Object.freeze({
    id: options.id ?? randomUUID(),
    goal: options.goal,
    createdAt: now,
    updatedAt: now,
    steps: Object.freeze(steps),
    version: 1,
  });
}

function defaultPlanPrompt(goal: string, max: number): string {
  return [
    `Decompose this goal into AT MOST ${max} atomic steps. Output one step per line as:`,
    `STEP <id> | <title> | depends:<id1,id2|none> | <one-line description>`,
    ``,
    `GOAL: ${goal}`,
  ].join('\n');
}

const STEP_LINE_RE = /^STEP\s+(\S+)\s*\|\s*(.+?)\s*\|\s*depends:([^|]+)\|\s*(.+)$/;

function parseBrainStepList(text: string): PlanStep[] {
  const steps: PlanStep[] = [];
  for (const line of text.split('\n')) {
    const m = STEP_LINE_RE.exec(line.trim());
    if (!m) continue;
    const id = m[1] ?? '';
    const title = m[2] ?? '';
    const deps = (m[3] ?? '').trim();
    const description = m[4] ?? '';
    const dependsOn =
      deps === '' || deps.toLowerCase() === 'none'
        ? []
        : deps
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean);
    steps.push(
      Object.freeze({
        id,
        title,
        description,
        dependsOn: Object.freeze(dependsOn),
        expectedOutput: description,
        status: 'pending' as const,
      }),
    );
  }
  return steps;
}

// ─────────────────────────────────────────────────────────────────
// Persist + load
// ─────────────────────────────────────────────────────────────────

export interface PersistPlanOptions {
  readonly plan: Plan;
  /** Directory; the file written is `<path>/PLAN.md`. */
  readonly path: string;
}

export async function persistPlan(options: PersistPlanOptions): Promise<string> {
  await mkdir(options.path, { recursive: true });
  const file = join(options.path, 'PLAN.md');
  await writeFile(file, renderPlanMarkdown(options.plan), 'utf8');
  return file;
}

function renderPlanMarkdown(plan: Plan): string {
  const header = [
    '---',
    `id: ${plan.id}`,
    `goal: ${JSON.stringify(plan.goal)}`,
    `createdAt: ${plan.createdAt}`,
    `updatedAt: ${plan.updatedAt}`,
    `version: ${plan.version}`,
    '---',
    '',
  ].join('\n');
  const body = plan.steps
    .map((s) => {
      const cp = s.checkpoint
        ? `\ncheckpoint: { completedAt: ${s.checkpoint.completedAt}, artifacts: ${JSON.stringify(s.checkpoint.artifacts)}${s.checkpoint.notes ? `, notes: ${JSON.stringify(s.checkpoint.notes)}` : ''} }`
        : '';
      return [
        `## step:${s.id} — ${s.title}`,
        '',
        `status: ${s.status}`,
        `dependsOn: [${s.dependsOn.join(',')}]`,
        `expectedOutput: ${JSON.stringify(s.expectedOutput)}${cp}`,
        '',
        s.description,
      ].join('\n');
    })
    .join('\n\n');
  return header + body + '\n';
}

export async function loadPlan(path: string): Promise<Plan> {
  const file = path.endsWith('.md') ? path : join(path, 'PLAN.md');
  const raw = await readFile(file, 'utf8');
  return parsePlanMarkdown(raw);
}

export function parsePlanMarkdown(raw: string): Plan {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error('plan-persistence: missing frontmatter');
  const fmBlock = fmMatch[1] ?? '';
  const rest = fmMatch[2] ?? '';
  const fm = parseFrontmatter(fmBlock);
  const goal = stripJsonString(fm['goal'] ?? '');
  const id = fm['id'] ?? '';
  const createdAt = Number(fm['createdAt'] ?? Date.now());
  const updatedAt = Number(fm['updatedAt'] ?? Date.now());
  const version = Number(fm['version'] ?? 1);

  // Tolerate either a leading newline before the first `## step:` or
  // no leading newline (when the frontmatter ends right next to it).
  const normalised = rest.startsWith('## step:') ? '\n' + rest : rest;
  const stepBlocks = normalised.split(/\n## step:/).slice(1);
  const steps: PlanStep[] = [];
  for (const block of stepBlocks) {
    const headerEnd = block.indexOf('\n');
    const headerLine = block.slice(0, headerEnd);
    const body = block.slice(headerEnd + 1);
    const [idPart, ...titleParts] = headerLine.split(' — ');
    const titleRaw = titleParts.join(' — ').trim();
    const statusMatch = body.match(/^status:\s*(\S+)/m);
    const depsMatch = body.match(/^dependsOn:\s*\[(.*?)\]/m);
    const expMatch = body.match(/^expectedOutput:\s*(.+)$/m);
    const cpMatch = body.match(/checkpoint:\s*\{(.+?)\}/);
    const description = body
      .split('\n')
      .filter((l) => !/^(status:|dependsOn:|expectedOutput:|checkpoint:)/.test(l))
      .join('\n')
      .trim();

    let checkpoint: PlanCheckpoint | undefined;
    if (cpMatch) {
      const cpBlock = cpMatch[1] ?? '';
      const completedAtMatch = cpBlock.match(/completedAt:\s*(\d+)/);
      const artifactsMatch = cpBlock.match(/artifacts:\s*(\[[^\]]*\])/);
      const notesMatch = cpBlock.match(/notes:\s*"((?:[^"\\]|\\.)*)"/);
      const completedAt = Number(completedAtMatch?.[1] ?? 0);
      let artifacts: ReadonlyArray<string> = [];
      try {
        artifacts = artifactsMatch
          ? (JSON.parse(artifactsMatch[1] ?? '[]') as string[])
          : [];
      } catch {
        artifacts = [];
      }
      checkpoint = Object.freeze({
        stepId: idPart ?? '',
        completedAt,
        artifacts: Object.freeze(artifacts),
        ...(notesMatch ? { notes: notesMatch[1] } : {}),
      });
    }

    steps.push(
      Object.freeze({
        id: idPart ?? '',
        title: titleRaw,
        description,
        dependsOn: parseDepsList(depsMatch?.[1] ?? ''),
        expectedOutput: stripJsonString(expMatch?.[1]?.split('checkpoint:')[0]?.trim() ?? ''),
        status: (statusMatch?.[1] ?? 'pending') as PlanStepStatus,
        ...(checkpoint !== undefined ? { checkpoint } : {}),
      }),
    );
  }

  return Object.freeze({
    id,
    goal,
    createdAt,
    updatedAt,
    steps: Object.freeze(steps),
    version,
  });
}

function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\S+):\s*(.*)$/);
    if (m && m[1] !== undefined) out[m[1]] = m[2] ?? '';
  }
  return out;
}

function parseDepsList(raw: string): ReadonlyArray<string> {
  const trimmed = raw.trim();
  if (!trimmed) return Object.freeze([]);
  return Object.freeze(
    trimmed
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
  );
}

function stripJsonString(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"')
  ) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────
// Mutation helpers
// ─────────────────────────────────────────────────────────────────

export function updateStepStatus(
  plan: Plan,
  stepId: string,
  status: PlanStepStatus,
): Plan {
  const updatedSteps = plan.steps.map((s) =>
    s.id === stepId ? Object.freeze({ ...s, status }) : s,
  );
  return Object.freeze({
    ...plan,
    steps: Object.freeze(updatedSteps),
    updatedAt: Date.now(),
    version: plan.version + 1,
  });
}

export function recordCheckpoint(plan: Plan, checkpoint: PlanCheckpoint): Plan {
  const updatedSteps = plan.steps.map((s) =>
    s.id === checkpoint.stepId
      ? Object.freeze({ ...s, checkpoint, status: 'done' as const })
      : s,
  );
  return Object.freeze({
    ...plan,
    steps: Object.freeze(updatedSteps),
    updatedAt: Date.now(),
    version: plan.version + 1,
  });
}

// ─────────────────────────────────────────────────────────────────
// Execute step
// ─────────────────────────────────────────────────────────────────

export interface ExecuteStepOptions {
  readonly plan: Plan;
  readonly stepId: string;
  readonly brain: BrainPort;
  readonly sandbox?: SandboxPort;
  readonly logger?: RuntimeLogger;
  /**
   * The work the step should actually do — caller supplies. Returns
   * the artifact list to record in the checkpoint.
   */
  readonly executor: (params: {
    readonly step: PlanStep;
    readonly brain: BrainPort;
    readonly sandbox: SandboxPort | undefined;
  }) => Promise<ReadonlyArray<string>>;
}

export interface ExecuteStepResult {
  readonly plan: Plan;
  readonly checkpoint: PlanCheckpoint;
}

export async function executeStep(options: ExecuteStepOptions): Promise<ExecuteStepResult> {
  const logger = options.logger ?? noopLogger;
  const step = options.plan.steps.find((s) => s.id === options.stepId);
  if (!step) throw new Error(`executeStep: unknown step ${options.stepId}`);
  for (const dep of step.dependsOn) {
    const depStep = options.plan.steps.find((s) => s.id === dep);
    if (!depStep || depStep.status !== 'done') {
      throw new Error(`executeStep: dependency ${dep} of ${step.id} not done`);
    }
  }
  logger.info('plan-persistence: executing step', { stepId: step.id });
  const artifacts = await options.executor({
    step,
    brain: options.brain,
    sandbox: options.sandbox,
  });
  const checkpoint: PlanCheckpoint = Object.freeze({
    stepId: step.id,
    completedAt: Date.now(),
    artifacts: Object.freeze([...artifacts]),
  });
  const newPlan = recordCheckpoint(options.plan, checkpoint);
  return Object.freeze({ plan: newPlan, checkpoint });
}

// ─────────────────────────────────────────────────────────────────
// Cache key — content hash of the plan
// ─────────────────────────────────────────────────────────────────

export function planContentHash(plan: Plan): string {
  return createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('hex')
    .slice(0, 24);
}
