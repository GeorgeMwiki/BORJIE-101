/**
 * Legacy portal driver — wraps a Playwright `Browser` + `Page` with an
 * a11y-tree-first perceive → decide → act → verify loop.
 *
 * Central Command Phase B B6 — used by the brain to drive legacy
 * vendor surfaces (KRA iTax, GePG, etc.) that expose no API. The driver
 * NEVER feeds the raw DOM to the brain; the AXTree is the perception
 * substrate. Anthropic Computer Use is reserved as a last-resort
 * actuator if a portal doesn't accessibly expose a control.
 *
 * SOTA robustness (Browser-use / Skyvern / MultiOn / WebVoyager /
 * Anthropic Computer Use):
 *   - page-load wait before perception (handles async renders);
 *   - locator-resolution FALLBACK CHAIN — exact a11y role/name → re-
 *     perceive + exact → fuzzy (Jaro-Winkler) candidate search →
 *     optional brain-ask — instead of a single brittle getByRole;
 *   - CONFIDENCE-GATED outcomes: an exact hit is `confidence:1.0`; a
 *     single high fuzzy hit proceeds at its score; multiple fuzzy hits
 *     surface `control-ambiguous` + candidates so the orchestrator can
 *     halt-for-help; zero hits surface `control-not-found`;
 *   - VERIFY-BY-DIFF with a CONTEXTUAL WAIT — after a click/submit the
 *     driver re-snapshots; if the page hasn't changed yet it waits and
 *     re-diffs (bounded) to catch slow alerts / modals / validations.
 *
 * Action vocabulary (`act(...)`):
 *   - {"verb": "click", "role": "button", "name": <regex|string>}
 *   - {"verb": "fill", "role": "textbox", "name": <regex|string>, "value": string}
 *   - {"verb": "navigate", "url": string}
 *   - {"verb": "submit", "role": "button", "name": <regex|string>}
 *
 * Errors are NEVER bare-thrown: every failure becomes a structured
 * `ActionResult` with `ok:false` + a `reason` (and, where relevant,
 * `candidates` + `confidence`). The caller (bridge) decides whether to
 * retry / re-plan / halt-for-help / abort.
 */

import {
  captureAxTreeSnapshot,
  flattenAxNodes,
  type AxNode,
  type AxTreeSnapshot,
  type PlaywrightPageLike,
} from './axtree-snapshot.js';
import { diffAxSnapshots, type AxTreeDiff } from './axtree-diff.js';
import { jaroWinklerSimilarity } from './fuzzy-match.js';

/** Minimal structured-logger surface (Pino-shaped `(meta, message)`). */
export interface DriverLogger {
  info?: (meta: object, message?: string) => void;
  warn?: (meta: object, message?: string) => void;
  error?: (meta: object, message?: string) => void;
}

/**
 * Optional brain port for the FINAL resolution fallback. When the a11y
 * exact + fuzzy chain is ambiguous, the driver may ask an LLM "which of
 * these candidates matches intent X?". Kept OPTIONAL so tests pass none
 * and the chain degrades to ambiguous/not-found without it.
 */
export interface BrainPort {
  resolveControl: (request: {
    readonly role: string;
    readonly intent: string;
    readonly candidates: ReadonlyArray<ControlCandidate>;
  }) => Promise<{ readonly name: string; readonly confidence: number } | null>;
}

export interface LegacyPortalDriverOptions {
  readonly page: DrivablePage;
  /** Max AX nodes per snapshot — defaults to 200 (sensorium cap). */
  readonly maxNodes?: number;
  /** Max AX depth per snapshot — defaults to 12. */
  readonly maxDepth?: number;
  /** Optional structured logger for per-attempt diagnostics. */
  readonly logger?: DriverLogger;
  /**
   * Optional LLM resolver — the 4th link in the action-resolution
   * fallback chain (a11y → re-perceive → fuzzy → ask-brain). Absent in
   * tests; the chain still works (degrades to ambiguous/not-found).
   */
  readonly brain?: BrainPort;
  /** Fuzzy acceptance floor (Jaro-Winkler). Default 0.65. */
  readonly fuzzyThreshold?: number;
  /** Page-load settle wait before perception, in ms. Default 2000. */
  readonly pageLoadWaitMs?: number;
  /** Per-poll contextual re-verify wait, in ms. Default 500. */
  readonly verifySettleMs?: number;
  /** Cap on total contextual verify wait, in ms. Default 2000. */
  readonly verifyMaxMs?: number;
  /** Injectable sleeper so tests run instantly. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Playwright surface the driver needs. */
export interface DrivablePage extends PlaywrightPageLike {
  goto: (url: string, opts?: unknown) => Promise<unknown>;
  fill?: (selector: string, value: string) => Promise<void>;
  click?: (selector: string) => Promise<void>;
  getByRole?: (
    role: string,
    opts?: { name?: string | RegExp; exact?: boolean },
  ) => LocatorLike;
  /** Playwright's load-state wait (optional — guarded with `?.`). */
  waitForLoadState?: (
    state?: 'load' | 'domcontentloaded' | 'networkidle',
    opts?: { timeout?: number },
  ) => Promise<void>;
}

export interface LocatorLike {
  click: (opts?: { timeout?: number }) => Promise<void>;
  fill: (value: string, opts?: { timeout?: number }) => Promise<void>;
  count?: () => Promise<number>;
}

export type LegacyPortalAction =
  | {
      readonly verb: 'click' | 'submit';
      readonly role: string;
      readonly name: string | RegExp;
    }
  | {
      readonly verb: 'fill';
      readonly role: string;
      readonly name: string | RegExp;
      readonly value: string;
    }
  | { readonly verb: 'navigate'; readonly url: string };

/** A fuzzy-matched control candidate surfaced for halt-for-help. */
export interface ControlCandidate {
  readonly role: string;
  readonly name: string;
  readonly score: number;
}

export interface ActionResult {
  readonly ok: boolean;
  readonly verb: LegacyPortalAction['verb'];
  readonly reason?: string;
  /**
   * Resolution confidence in [0,1]. Exact a11y hit = 1.0; a fuzzy hit
   * carries its similarity score. Absent on navigate / hard failures.
   */
  readonly confidence?: number;
  /**
   * Ranked fuzzy candidates — populated when resolution was ambiguous
   * or not-found so the orchestrator can halt-for-help / re-plan.
   */
  readonly candidates?: ReadonlyArray<ControlCandidate>;
  /** Snapshot captured AFTER the action. */
  readonly postActionSnapshot: AxTreeSnapshot;
  /** Diff against the pre-action snapshot. */
  readonly diff: AxTreeDiff;
}

export interface PortalCredentials {
  readonly username: string;
  readonly password: string;
  /** Optional TOTP / OTP code — if absent, the driver halts when prompted. */
  readonly mfaCode?: string;
}

const VERBS_THAT_MUTATE: ReadonlySet<LegacyPortalAction['verb']> = new Set([
  'click',
  'submit',
]);

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class LegacyPortalDriver {
  private readonly page: DrivablePage;
  private readonly maxNodes: number;
  private readonly maxDepth: number;
  private readonly logger: DriverLogger | undefined;
  private readonly brain: BrainPort | undefined;
  private readonly fuzzyThreshold: number;
  private readonly pageLoadWaitMs: number;
  private readonly verifySettleMs: number;
  private readonly verifyMaxMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastSnapshot: AxTreeSnapshot | null = null;

  constructor(opts: LegacyPortalDriverOptions) {
    if (!opts.page) {
      throw new Error('legacy-portal-driver: page is required');
    }
    this.page = opts.page;
    this.maxNodes = opts.maxNodes ?? 200;
    this.maxDepth = opts.maxDepth ?? 12;
    this.logger = opts.logger;
    this.brain = opts.brain;
    this.fuzzyThreshold = opts.fuzzyThreshold ?? 0.65;
    this.pageLoadWaitMs = opts.pageLoadWaitMs ?? 2000;
    this.verifySettleMs = opts.verifySettleMs ?? 500;
    this.verifyMaxMs = opts.verifyMaxMs ?? 2000;
    this.sleep = opts.sleep ?? realSleep;
  }

  /** Navigate to the portal entry url and capture the initial snapshot. */
  async openPortal(
    url: string,
    _credentials?: PortalCredentials,
  ): Promise<AxTreeSnapshot> {
    await this.page.goto(url);
    await this.waitForPageSettle();
    const snap = await this.snapshot();
    this.lastSnapshot = snap;
    return snap;
  }

  /** Capture an AXTree snapshot using configured caps. */
  async snapshot(): Promise<AxTreeSnapshot> {
    return captureAxTreeSnapshot(this.page, {
      maxNodes: this.maxNodes,
      maxDepth: this.maxDepth,
      interestingOnly: true,
    });
  }

  /** Get the last captured snapshot (null until {@link openPortal} runs). */
  getLastSnapshot(): AxTreeSnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * Best-effort page-load settle. Playwright's `waitForLoadState` is
   * optional on the surface; when absent (test fakes) this is a no-op.
   * A timeout here is swallowed — perception proceeds with whatever
   * rendered so the loop never stalls on a slow background fetch.
   */
  private async waitForPageSettle(): Promise<void> {
    const wait = this.page.waitForLoadState;
    if (typeof wait !== 'function' || this.pageLoadWaitMs <= 0) return;
    try {
      await wait.call(this.page, 'networkidle', {
        timeout: this.pageLoadWaitMs,
      });
    } catch {
      // networkidle never settled within the budget — proceed anyway.
    }
  }

  /**
   * Locate the first node in the current snapshot matching `(role, name)`.
   * Returns null if not found. Doesn't mutate page state.
   */
  async findRoleByName(
    role: string,
    namePattern: string | RegExp,
  ): Promise<AxNode | null> {
    const snap = this.lastSnapshot ?? (await this.snapshot());
    this.lastSnapshot = snap;
    const re =
      namePattern instanceof RegExp
        ? namePattern
        : new RegExp(namePattern, 'i');
    return (
      flattenAxNodes(snap.root).find(
        (n) => n.role === role && re.test(n.name ?? ''),
      ) ?? null
    );
  }

  /**
   * Rank candidate controls of the given role by Jaro-Winkler similarity
   * to the requested name, descending, above the fuzzy threshold.
   */
  findCandidates(
    role: string,
    name: string | RegExp,
    snapshot?: AxTreeSnapshot | null,
  ): ControlCandidate[] {
    const snap = snapshot ?? this.lastSnapshot;
    const target = this.patternToText(name);
    const out: ControlCandidate[] = [];
    for (const node of flattenAxNodes(snap?.root ?? null)) {
      if (node.role !== role) continue;
      const candidateName = (node.name ?? '').trim();
      if (!candidateName) continue;
      const score = jaroWinklerSimilarity(
        target.toLowerCase(),
        candidateName.toLowerCase(),
      );
      if (score >= this.fuzzyThreshold) {
        out.push({ role, name: candidateName, score });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /** Lower a regex/string name pattern to a plain text seed for fuzzy. */
  private patternToText(name: string | RegExp): string {
    if (typeof name === 'string') return name;
    // Strip regex anchors/flags noise — keep the literal-ish source.
    return name.source.replace(/[\\^$.*+?()[\]{}|]/g, ' ').trim();
  }

  /**
   * Execute a structured action and report the post-action snapshot
   * + diff. Untyped NL inputs should be lowered to {@link LegacyPortalAction}
   * by the brain BEFORE calling `act` (we don't want regex-injection
   * surface inside the driver).
   *
   * NEVER throws — failures return `{ ok:false, reason, candidates? }`.
   */
  async act(action: LegacyPortalAction): Promise<ActionResult> {
    await this.waitForPageSettle();
    const before = this.lastSnapshot ?? (await this.snapshot());
    this.lastSnapshot = before;

    if (action.verb === 'navigate') {
      return this.actNavigate(action, before);
    }
    return this.actOnControl(action, before);
  }

  private async actNavigate(
    action: Extract<LegacyPortalAction, { verb: 'navigate' }>,
    before: AxTreeSnapshot,
  ): Promise<ActionResult> {
    let ok = true;
    let reason: string | undefined;
    try {
      await this.page.goto(action.url);
      await this.waitForPageSettle();
    } catch (err) {
      ok = false;
      reason = err instanceof Error ? err.message : 'unknown';
    }
    const after = await this.snapshot();
    this.lastSnapshot = after;
    this.log('info', {
      verb: 'navigate',
      ok,
      ...(reason ? { reason } : {}),
    });
    return {
      ok,
      verb: 'navigate',
      ...(reason !== undefined ? { reason } : {}),
      ...(ok ? { confidence: 1 } : {}),
      postActionSnapshot: after,
      diff: diffAxSnapshots(before, after),
    };
  }

  private async actOnControl(
    action: Extract<
      LegacyPortalAction,
      { verb: 'click' | 'submit' | 'fill' }
    >,
    before: AxTreeSnapshot,
  ): Promise<ActionResult> {
    if (typeof this.page.getByRole !== 'function') {
      return this.failure(action.verb, 'getByRole-unavailable', before);
    }

    const resolution = await this.resolveControl(action, before);
    if (resolution.ok === false) {
      const after = await this.snapshot();
      this.lastSnapshot = after;
      this.log('warn', {
        verb: action.verb,
        ok: false,
        reason: resolution.reason,
        candidates: resolution.candidates.length,
      });
      return {
        ok: false,
        verb: action.verb,
        reason: resolution.reason,
        ...(resolution.candidates.length > 0
          ? { candidates: resolution.candidates }
          : {}),
        postActionSnapshot: after,
        diff: diffAxSnapshots(before, after),
      };
    }

    // We have a resolved name to target. Drive the locator.
    let ok = true;
    let reason: string | undefined;
    try {
      const locator = this.page.getByRole!(action.role, {
        name: resolution.name,
      });
      if (!locator) {
        return this.failure(action.verb, 'getByRole-unavailable', before);
      }
      if (action.verb === 'fill') {
        await locator.fill(action.value, { timeout: 5000 });
      } else {
        await locator.click({ timeout: 5000 });
      }
    } catch (err) {
      ok = false;
      reason = err instanceof Error ? err.message : 'unknown';
    }

    let after = await this.snapshot();
    this.lastSnapshot = after;
    let diff = diffAxSnapshots(before, after);

    // Verify-by-diff + contextual wait — only for mutating verbs that
    // are EXPECTED to change the page. A click/submit that shows no diff
    // yet may have a slow async alert/modal; wait and re-diff (bounded).
    if (ok && VERBS_THAT_MUTATE.has(action.verb) && diff.identical) {
      const settled = await this.contextualReverify(before);
      after = settled.after;
      diff = settled.diff;
      this.lastSnapshot = after;
    }

    this.log('info', {
      verb: action.verb,
      ok,
      ...(reason ? { reason } : {}),
      confidence: resolution.confidence,
      diffIdentical: diff.identical,
    });

    return {
      ok,
      verb: action.verb,
      ...(reason !== undefined ? { reason } : {}),
      confidence: resolution.confidence,
      postActionSnapshot: after,
      diff,
    };
  }

  /**
   * The action-resolution FALLBACK CHAIN:
   *   1. exact a11y match against the current snapshot;
   *   2. re-perceive (fresh snapshot) + exact match (handles a control
   *      that rendered late);
   *   3. fuzzy Jaro-Winkler candidate search — single high hit proceeds
   *      at its score; multiple → `control-ambiguous`;
   *   4. optional brain-ask over the candidates;
   *   5. `control-not-found`.
   *
   * Returns the resolved name + confidence, or a fatal reason +
   * candidates the orchestrator surfaces.
   */
  private async resolveControl(
    action: Extract<LegacyPortalAction, { verb: 'click' | 'submit' | 'fill' }>,
    before: AxTreeSnapshot,
  ): Promise<
    | { readonly ok: true; readonly name: string | RegExp; readonly confidence: number }
    | { readonly ok: false; readonly reason: string; readonly candidates: ControlCandidate[] }
  > {
    // 1. exact match against the pre-action snapshot.
    const exact = this.exactMatch(action.role, action.name, before);
    if (exact) {
      return { ok: true, name: action.name, confidence: 1 };
    }

    // 2. re-perceive and try exact again (late-rendered control).
    const fresh = await this.snapshot();
    this.lastSnapshot = fresh;
    const exactFresh = this.exactMatch(action.role, action.name, fresh);
    if (exactFresh) {
      return { ok: true, name: action.name, confidence: 1 };
    }

    // 3. fuzzy candidate search.
    const candidates = this.findCandidates(action.role, action.name, fresh);
    if (candidates.length === 1) {
      const only = candidates[0]!;
      return { ok: true, name: only.name, confidence: only.score };
    }
    if (candidates.length > 1) {
      // Two distinct strong hits → genuinely ambiguous. A clearly
      // dominant top hit (well clear of the runner-up) is NOT ambiguous.
      const [top, second] = candidates;
      if (top && second && top.score - second.score >= 0.15) {
        return { ok: true, name: top.name, confidence: top.score };
      }
      // 4. optional brain-ask to disambiguate.
      const picked = await this.askBrain(action, candidates);
      if (picked) {
        return { ok: true, name: picked.name, confidence: picked.confidence };
      }
      return {
        ok: false,
        reason: 'control-ambiguous',
        candidates,
      };
    }

    // No fuzzy candidates at all → maybe the brain still knows; else fail.
    const picked = await this.askBrain(action, candidates);
    if (picked) {
      return { ok: true, name: picked.name, confidence: picked.confidence };
    }
    return { ok: false, reason: 'control-not-found', candidates };
  }

  private exactMatch(
    role: string,
    name: string | RegExp,
    snapshot: AxTreeSnapshot,
  ): boolean {
    const re =
      name instanceof RegExp ? name : new RegExp(escapeRegExp(name), 'i');
    return flattenAxNodes(snapshot.root).some(
      (n) => n.role === role && re.test(n.name ?? ''),
    );
  }

  private async askBrain(
    action: Extract<LegacyPortalAction, { verb: 'click' | 'submit' | 'fill' }>,
    candidates: ControlCandidate[],
  ): Promise<{ name: string; confidence: number } | null> {
    if (!this.brain) return null;
    try {
      const picked = await this.brain.resolveControl({
        role: action.role,
        intent: this.patternToText(action.name),
        candidates,
      });
      return picked ?? null;
    } catch (err) {
      this.log('warn', {
        verb: action.verb,
        brainAsk: 'failed',
        reason: err instanceof Error ? err.message : 'unknown',
      });
      return null;
    }
  }

  /**
   * Contextual re-verify: re-snapshot + re-diff every `verifySettleMs`
   * up to `verifyMaxMs`, returning as soon as a non-identical diff
   * appears (the slow alert / modal arrived) or the budget expires.
   */
  private async contextualReverify(
    before: AxTreeSnapshot,
  ): Promise<{ after: AxTreeSnapshot; diff: AxTreeDiff }> {
    let elapsed = 0;
    let after = this.lastSnapshot ?? before;
    let diff = diffAxSnapshots(before, after);
    while (diff.identical && elapsed < this.verifyMaxMs) {
      await this.sleep(this.verifySettleMs);
      elapsed += this.verifySettleMs;
      after = await this.snapshot();
      diff = diffAxSnapshots(before, after);
    }
    return { after, diff };
  }

  private async failure(
    verb: LegacyPortalAction['verb'],
    reason: string,
    before: AxTreeSnapshot,
  ): Promise<ActionResult> {
    const after = await this.snapshot();
    this.lastSnapshot = after;
    this.log('warn', { verb, ok: false, reason });
    return {
      ok: false,
      verb,
      reason,
      postActionSnapshot: after,
      diff: diffAxSnapshots(before, after),
    };
  }

  private log(
    level: 'info' | 'warn' | 'error',
    meta: Record<string, unknown>,
  ): void {
    const fn = this.logger?.[level];
    if (typeof fn === 'function') {
      fn({ driver: 'legacy-portal', ...meta }, 'legacy-portal-driver:act');
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
