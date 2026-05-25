import type {
  RunSoTInput,
  RunSoTResult,
  SoTEvent,
  SoTPoint,
} from './types.js';

const TIMEOUT_PLACEHOLDER = '<timeout>';

/**
 * Parse the skeleton model output. We accept either a newline-separated
 * numbered list (`1. Foo`) or a JSON array (the prompt requests JSON; the
 * fallback is for models that ignore the format instruction).
 */
function parseSkeleton(raw: string, maxBranches: number): ReadonlyArray<string> {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const items = parsed.filter((x): x is string => typeof x === 'string');
        return items.slice(0, maxBranches);
      }
    } catch {
      // fall through to line parsing
    }
  }
  const lines = trimmed.split(/\r?\n/);
  const points: string[] = [];
  for (const line of lines) {
    const m = /^\s*(?:\d+[.)]|[-*])\s*(.+)$/.exec(line);
    if (m && m[1] !== undefined) {
      const title = m[1].trim();
      if (title.length > 0) points.push(title);
    }
  }
  return points.slice(0, maxBranches);
}

/**
 * Run a point expansion with a wall-clock budget. Resolves with content on
 * success or `<timeout>` on timeout. Never rejects — the orchestrator must
 * stay non-throwing so a single slow point doesn't tank the whole answer.
 */
async function expandPointWithBudget(
  pointPrompt: string,
  pointModel: RunSoTInput['pointModel'],
  budgetMs: number,
): Promise<string> {
  if (budgetMs <= 0) {
    // No budget — skip; this means caller wants placeholders only.
    return TIMEOUT_PLACEHOLDER;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_PLACEHOLDER), budgetMs);
  });
  try {
    const result = await Promise.race([
      pointModel({ prompt: pointPrompt, tier: 'quality' }),
      timeout,
    ]);
    return result;
  } catch (err) {
    return `<error: ${err instanceof Error ? err.message : 'unknown'}>`;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run SoT. Returns once all points are ready (or timed out) and the
 * synthesis pass completes. The `onEvent` callback fires three event kinds:
 * `skeleton-ready` (FMP marker), `point-ready` (per-point), `synthesis-ready`.
 */
export async function runSoT(input: RunSoTInput): Promise<RunSoTResult> {
  const maxBranches = Math.max(1, Math.min(12, input.maxBranches ?? 5));
  const budgetMs = input.branchTimeoutMs ?? 4000;
  const now = input.nowMs ?? (() => performance.now());
  const start = now();
  const events: SoTEvent[] = [];
  const emit = (ev: SoTEvent): void => {
    events.push(ev);
    input.onEvent?.(ev);
  };

  // === Skeleton pass (fast tier) ===
  const skeletonPrompt =
    `${input.question}\n\nProduce an answer skeleton — a JSON array of up to ${maxBranches} short titles ` +
    `(3-7 words each) that together cover the answer. JSON only, no prose.`;
  const skeletonRaw = await input.skeletonModel({ prompt: skeletonPrompt, tier: 'fast' });
  const skeleton = parseSkeleton(skeletonRaw, maxBranches);
  if (skeleton.length === 0) {
    throw new Error('[SoT] skeleton model returned no usable points');
  }
  const fmpMs = now() - start;
  emit({ kind: 'skeleton-ready', titles: skeleton, fmpMs });

  // === Point expansion (parallel) ===
  const pointPromises = skeleton.map(async (title, index): Promise<SoTPoint> => {
    const prompt = `${input.question}\n\nExpand this point only (1-3 short sentences): "${title}"`;
    const content = await expandPointWithBudget(prompt, input.pointModel, budgetMs);
    const elapsedMs = now() - start;
    const point: SoTPoint = { index, title, content: content.trim(), elapsedMs };
    emit({ kind: 'point-ready', point });
    return point;
  });
  const points = await Promise.all(pointPromises);

  // === Synthesis (fast tier, optional) ===
  let text: string;
  if (input.synthesisModel !== undefined) {
    const synthesisPrompt =
      `${input.question}\n\nStitch the following points into prose. Keep tone steady; drop duplicates; do not invent facts.\n\n` +
      points.map((p, i) => `${i + 1}. ${p.title} — ${p.content}`).join('\n');
    text = (await input.synthesisModel({ prompt: synthesisPrompt, tier: 'fast' })).trim();
  } else {
    text = points.map((p) => `**${p.title}** — ${p.content}`).join('\n\n');
  }
  const totalMs = now() - start;
  emit({ kind: 'synthesis-ready', text, totalMs });

  return { skeleton, points, text, fmpMs, totalMs };
}

export const __test_helpers = { parseSkeleton } as const;
