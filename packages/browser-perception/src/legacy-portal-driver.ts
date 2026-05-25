/**
 * Legacy portal driver — wraps a Playwright `Browser` + `Page` with an
 * a11y-tree-first perception loop.
 *
 * Central Command Phase B B6 — used by the brain to drive legacy
 * vendor surfaces (KRA iTax, GePG, etc.) that expose no API. The driver
 * NEVER feeds the raw DOM to the brain; the AXTree is the perception
 * substrate. Anthropic Computer Use is reserved as a last-resort
 * actuator if a portal doesn't accessibly expose a control.
 *
 * Action vocabulary (`act(...)`):
 *   - {"verb": "click", "role": "button", "name": <regex|string>}
 *   - {"verb": "fill", "role": "textbox", "name": <regex|string>, "value": string}
 *   - {"verb": "navigate", "url": string}
 *   - {"verb": "submit", "role": "button", "name": <regex|string>}
 *
 * Errors are non-fatal: if a control isn't found, the driver returns
 * `{actionResult: { ok: false, reason: 'control-not-found' }}` and the
 * caller decides whether to retry / fallback / abort.
 */

import {
  captureAxTreeSnapshot,
  flattenAxNodes,
  type AxNode,
  type AxTreeSnapshot,
  type PlaywrightPageLike,
} from './axtree-snapshot.js';
import { diffAxSnapshots, type AxTreeDiff } from './axtree-diff.js';

export interface LegacyPortalDriverOptions {
  readonly page: DrivablePage;
  /** Max AX nodes per snapshot — defaults to 200 (sensorium cap). */
  readonly maxNodes?: number;
  /** Max AX depth per snapshot — defaults to 12. */
  readonly maxDepth?: number;
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

export interface ActionResult {
  readonly ok: boolean;
  readonly verb: LegacyPortalAction['verb'];
  readonly reason?: string;
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

export class LegacyPortalDriver {
  private readonly page: DrivablePage;
  private readonly maxNodes: number;
  private readonly maxDepth: number;
  private lastSnapshot: AxTreeSnapshot | null = null;

  constructor(opts: LegacyPortalDriverOptions) {
    if (!opts.page) {
      throw new Error('legacy-portal-driver: page is required');
    }
    this.page = opts.page;
    this.maxNodes = opts.maxNodes ?? 200;
    this.maxDepth = opts.maxDepth ?? 12;
  }

  /** Navigate to the portal entry url and capture the initial snapshot. */
  async openPortal(
    url: string,
    _credentials?: PortalCredentials,
  ): Promise<AxTreeSnapshot> {
    await this.page.goto(url);
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
   * Execute a structured action and report the post-action snapshot
   * + diff. Untyped NL inputs should be lowered to {@link LegacyPortalAction}
   * by the brain BEFORE calling `act` (we don't want regex-injection
   * surface inside the driver).
   */
  async act(action: LegacyPortalAction): Promise<ActionResult> {
    const before = this.lastSnapshot ?? (await this.snapshot());
    this.lastSnapshot = before;

    let ok = true;
    let reason: string | undefined;

    try {
      switch (action.verb) {
        case 'navigate':
          await this.page.goto(action.url);
          break;

        case 'click':
        case 'submit': {
          const locator = this.page.getByRole?.(action.role, {
            name: action.name,
          });
          if (!locator) {
            ok = false;
            reason = 'getByRole-unavailable';
            break;
          }
          await locator.click({ timeout: 5000 });
          break;
        }

        case 'fill': {
          const locator = this.page.getByRole?.(action.role, {
            name: action.name,
          });
          if (!locator) {
            ok = false;
            reason = 'getByRole-unavailable';
            break;
          }
          await locator.fill(action.value, { timeout: 5000 });
          break;
        }

        default:
          ok = false;
          reason = 'unknown-verb';
      }
    } catch (err) {
      ok = false;
      reason = err instanceof Error ? err.message : 'unknown';
    }

    const after = await this.snapshot();
    this.lastSnapshot = after;
    const diff = diffAxSnapshots(before, after);
    return {
      ok,
      verb: action.verb,
      ...(reason !== undefined ? { reason } : {}),
      postActionSnapshot: after,
      diff,
    };
  }
}
