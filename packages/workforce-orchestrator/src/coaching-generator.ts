/**
 * Piece M — coaching-generator.
 *
 * Generates a coaching_prompt when a signal threshold is crossed. The
 * canonical triggers:
 *   * repeated_blocker  → "let's set up a 1-on-1" prompt
 *   * missed_deadline   → "what got in the way?" prompt
 *   * mastery_milestone → positive recognition prompt
 *   * low_sentiment     → "is everything OK?" prompt
 *
 * HITL: if prompt_text mentions disciplinary language (terminate, fire,
 * dismiss, demote, write-up, PIP, final warning) the kernel WRITES the
 * row with status='pending' and DOES NOT auto-send. A manager must flip
 * status='sent' explicitly. Without disciplinary content, the prompt is
 * auto-sent and status='sent' on first write.
 */

import { z } from 'zod';
import {
  CoachingPromptSchema,
  type CoachingPrompt,
  type CoachingTriggerKind,
  type PerformanceSignal,
  type WorkforceDeps,
} from './types.js';

const DISCIPLINARY_PATTERNS = [
  /\bterminat\w*\b/i,
  /\bfire\b/i,
  /\bdismiss\w*\b/i,
  /\bdemot\w*\b/i,
  /\bwrite[\s-]?up\b/i,
  /\bPIP\b/,
  /\bfinal warning\b/i,
];

export function mentionsDisciplinaryLanguage(text: string): boolean {
  return DISCIPLINARY_PATTERNS.some((p) => p.test(text));
}

export const GenerateCoachingInputSchema = z.object({
  tenantId: z.string().min(1),
  employeeId: z.string().min(1),
  triggerKind: z.enum([
    'repeated_blocker',
    'missed_deadline',
    'mastery_milestone',
    'low_sentiment',
    'exceptional_recognition',
  ]),
});

export type GenerateCoachingInput = z.infer<typeof GenerateCoachingInputSchema>;

const RECENT_SIGNAL_WINDOW_MS = 60 * 24 * 3_600_000;

export async function generateCoachingPrompt(
  deps: WorkforceDeps,
  rawInput: GenerateCoachingInput
): Promise<CoachingPrompt> {
  const input = GenerateCoachingInputSchema.parse(rawInput);

  const employee = await deps.store.getEmployee(input.tenantId, input.employeeId);
  if (!employee) {
    throw new Error(`generateCoachingPrompt: employee ${input.employeeId} not found`);
  }

  const since = new Date(deps.clock().getTime() - RECENT_SIGNAL_WINDOW_MS);
  const signals: PerformanceSignal[] = await deps.store.listSignalsForEmployee(
    input.tenantId,
    input.employeeId,
    since
  );

  const { text } = await deps.content.generateCoaching({
    tenantId: input.tenantId,
    employee,
    triggerKind: input.triggerKind,
    recentSignals: signals,
  });

  const isDisciplinary = mentionsDisciplinaryLanguage(text);
  const now = deps.clock().toISOString();
  const status = isDisciplinary ? 'pending' : 'sent';

  const row: CoachingPrompt = CoachingPromptSchema.parse({
    id: deps.uuid(),
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    triggerKind: input.triggerKind,
    promptText: text,
    status,
    sentAt: status === 'sent' ? now : null,
    createdAt: now,
  });

  await deps.store.insertCoachingPrompt(row);

  // Audit (fire-and-forget).
  try {
    await deps.audit.append({
      tenantId: input.tenantId,
      action: 'workforce.coaching_prompt',
      payload: {
        coachingPromptId: row.id,
        triggerKind: input.triggerKind,
        isDisciplinary,
        hitlGated: isDisciplinary,
      },
    });
  } catch {
    // intentionally swallowed
  }

  // If non-disciplinary, dispatch immediately.
  if (!isDisciplinary) {
    try {
      await deps.channel.send({
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        channel: employee.defaultChannel,
        template: `workforce.coaching.${input.triggerKind}`,
        payload: { text, coachingPromptId: row.id },
      });
    } catch {
      // intentionally swallowed — caller can retry by reading
      // workforce.coaching_prompts where status=sent && sent_at older
      // than X.
    }
  }

  return row;
}

/**
 * Auto-trigger pass over an employee's recent signals. Returns the
 * triggers fired (does not de-duplicate against historical prompts —
 * the caller is responsible for rate-limiting).
 */
export async function autoTriggerCoaching(
  deps: WorkforceDeps,
  args: { tenantId: string; employeeId: string }
): Promise<CoachingTriggerKind[]> {
  const since = new Date(deps.clock().getTime() - RECENT_SIGNAL_WINDOW_MS);
  const signals = await deps.store.listSignalsForEmployee(
    args.tenantId,
    args.employeeId,
    since
  );

  const counts: Record<string, number> = {};
  for (const s of signals) counts[s.signalKind] = (counts[s.signalKind] ?? 0) + 1;

  const triggers: CoachingTriggerKind[] = [];
  if ((counts['repeated_blocker'] ?? 0) >= 1) triggers.push('repeated_blocker');
  if ((counts['missed_deadline'] ?? 0) >= 2) triggers.push('missed_deadline');
  if ((counts['negative_sentiment'] ?? 0) >= 3) triggers.push('low_sentiment');
  if ((counts['exceptional_work'] ?? 0) >= 1) triggers.push('exceptional_recognition');

  for (const triggerKind of triggers) {
    await generateCoachingPrompt(deps, {
      tenantId: args.tenantId,
      employeeId: args.employeeId,
      triggerKind,
    });
  }

  return triggers;
}
