/**
 * Hook engine — Claude-Code-compatible.
 *
 * Discovers `.claude/hooks/<event>.json` files in the project root,
 * registers programmatic hooks via `registerHook`, and runs the
 * matching chain on every `runHooks(event, ctx)` call.
 *
 * Outcome composition (per the 2026 Claude Agent SDK contract):
 *
 *   - PreToolUse: first hook that returns permissionDecision='deny'
 *     short-circuits the chain. `updatedInput` is last-write-wins.
 *   - PostToolUse / others: every hook runs; `additionalContext` and
 *     `log` accumulate.
 *
 * The matcher is a RegExp source string on `toolName`. `'*'` matches
 * every tool call. Omitting `matcher` is equivalent to `'*'`.
 *
 * This engine does NOT spawn subprocess hooks (which Claude Code does
 * for shell-script hooks). Hooks here are in-process JS functions —
 * we keep the cross-process boundary out of the runtime so callers
 * can wire it to the existing `central-intelligence` hook-chain or to
 * the subprocess executor in a separate adapter package.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  Hook,
  HookContext,
  HookEvent,
  HookHandler,
  HookOutput,
  HookResult,
  RuntimeLogger,
} from '../types.js';
import { noopLogger } from '../types.js';

export interface HookEngineOptions {
  readonly projectPath: string;
  readonly logger?: RuntimeLogger;
}

const ALL_EVENTS: ReadonlyArray<HookEvent> = Object.freeze([
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'UserPromptSubmit',
  'SessionStart',
  'Notification',
  'PreCompact',
]);

export function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === 'string' && (ALL_EVENTS as ReadonlyArray<string>).includes(value);
}

export class HookEngine {
  readonly #projectPath: string;
  readonly #logger: RuntimeLogger;
  readonly #hooks = new Map<HookEvent, Hook[]>();

  constructor(opts: HookEngineOptions) {
    this.#projectPath = opts.projectPath;
    this.#logger = opts.logger ?? noopLogger;
    for (const event of ALL_EVENTS) {
      this.#hooks.set(event, []);
    }
  }

  /** Programmatic registration — returns an unregister callback. */
  registerHook(spec: {
    readonly event: HookEvent;
    readonly matcher?: string;
    readonly handler: HookHandler;
    readonly id?: string;
  }): () => void {
    const id = spec.id ?? `hook-${spec.event}-${cryptoRandom()}`;
    const hook: Hook = {
      id,
      event: spec.event,
      ...(spec.matcher !== undefined ? { matcher: spec.matcher } : {}),
      handler: spec.handler,
    };
    const bucket = this.#hooks.get(spec.event);
    if (bucket === undefined) {
      throw new Error(`Unknown hook event: ${spec.event}`);
    }
    bucket.push(hook);
    return () => {
      const after = bucket.filter((h) => h.id !== id);
      this.#hooks.set(spec.event, after);
    };
  }

  /**
   * Discover file-based hooks under `<projectPath>/.claude/hooks/`.
   *
   * Each hook is a JSON file named `<event>.json` (or `<event>-<n>.json`)
   * with shape:
   *
   *   {
   *     "matcher": "Write|Edit",
   *     "handler": "module:exportName"   // import-resolved, must be sync fn
   *   }
   *
   * Since we can't safely `import()` arbitrary user code in a library,
   * file-based hook loading is intentionally limited to a manifest that
   * lists hook *names* — the caller passes in a `resolver` to turn each
   * name into an actual `HookHandler`.
   */
  async loadFileHooks(args: {
    readonly resolver: (name: string) => HookHandler | undefined;
  }): Promise<number> {
    const hooksDir = join(this.#projectPath, '.claude', 'hooks');
    if (!existsSync(hooksDir)) {
      return 0;
    }
    const files = await readdir(hooksDir);
    let count = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const event = inferEventFromFilename(file);
      if (event === undefined) {
        this.#logger.log('warn', `agent-runtime: skip hook file with unknown event: ${file}`);
        continue;
      }
      const raw = await readFile(join(hooksDir, file), 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        this.#logger.log('warn', `agent-runtime: invalid hook JSON ${file}`, {
          error: (err as Error).message,
        });
        continue;
      }
      const specs = Array.isArray(parsed) ? parsed : [parsed];
      for (const spec of specs) {
        if (!isHookSpec(spec)) continue;
        const handler = args.resolver(spec.handler);
        if (handler === undefined) {
          this.#logger.log('warn', `agent-runtime: unresolved hook handler ${spec.handler}`);
          continue;
        }
        this.registerHook({
          event,
          ...(spec.matcher !== undefined ? { matcher: spec.matcher } : {}),
          handler,
          id: `file:${file}:${spec.handler}`,
        });
        count += 1;
      }
    }
    return count;
  }

  /**
   * Fire every hook matching `event` + `toolName` in registration
   * order. Composes their HookOutputs into a single HookResult.
   *
   * Composition rules:
   *   - PreToolUse:
   *      • first `deny`  → halts; final = deny
   *      • first `ask`   → carried unless a later hook denies
   *      • `updatedInput`: last write wins
   *      • `additionalContext`: accumulated
   *   - PostToolUse / others:
   *      • every hook runs
   *      • only `additionalContext` and `log` are collected
   */
  async runHooks(event: HookEvent, ctx: Omit<HookContext, 'event'>): Promise<HookResult> {
    const fullCtx: HookContext = { event, ...ctx };
    const bucket = this.#hooks.get(event) ?? [];
    let decision: HookResult['decision'] = 'allow';
    let reason: string | undefined;
    let updatedInput: Readonly<Record<string, unknown>> | undefined;
    const additionalContext: string[] = [];
    const logs: string[] = [];

    for (const hook of bucket) {
      if (!matches(hook, ctx.toolName)) continue;
      let output: HookOutput | void;
      try {
        output = await hook.handler(fullCtx);
      } catch (err) {
        const message = (err as Error).message;
        this.#logger.log('error', `agent-runtime: hook ${hook.id} threw`, { error: message });
        // Treat thrown hooks as deny for safety on PreToolUse.
        if (event === 'PreToolUse') {
          return Object.freeze({
            decision: 'deny',
            reason: `hook ${hook.id} threw: ${message}`,
            additionalContext: Object.freeze([...additionalContext]),
            logs: Object.freeze([...logs, `hook-error: ${hook.id}: ${message}`]),
          });
        }
        logs.push(`hook-error: ${hook.id}: ${message}`);
        continue;
      }
      if (!output) continue;
      if (output.log !== undefined) logs.push(output.log);
      const hookSpecific = output.hookSpecificOutput;
      if (hookSpecific === undefined) continue;
      if (hookSpecific.additionalContext !== undefined) {
        additionalContext.push(hookSpecific.additionalContext);
      }
      if (hookSpecific.updatedInput !== undefined) {
        updatedInput = hookSpecific.updatedInput;
      }
      if (event === 'PreToolUse' && hookSpecific.permissionDecision !== undefined) {
        if (hookSpecific.permissionDecision === 'deny') {
          decision = 'deny';
          reason = hookSpecific.permissionDecisionReason ?? `hook ${hook.id} denied`;
          break;
        }
        if (hookSpecific.permissionDecision === 'ask') {
          if (decision === 'allow') {
            decision = 'ask';
            reason = hookSpecific.permissionDecisionReason ?? `hook ${hook.id} requested approval`;
          }
        }
      }
    }

    const result: HookResult = {
      decision,
      ...(reason !== undefined ? { reason } : {}),
      ...(updatedInput !== undefined ? { updatedInput } : {}),
      additionalContext: Object.freeze([...additionalContext]),
      logs: Object.freeze([...logs]),
    };
    return Object.freeze(result);
  }

  /** Used by tests + diagnostics. */
  listHooks(event: HookEvent): ReadonlyArray<Hook> {
    return Object.freeze([...(this.#hooks.get(event) ?? [])]);
  }
}

// ─────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────

function matches(hook: Hook, toolName: string | undefined): boolean {
  const matcher = hook.matcher;
  if (matcher === undefined || matcher === '*') return true;
  if (toolName === undefined) return false;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return matcher === toolName;
  }
}

/**
 * Resolves a hook event from a filename.
 *
 * Accepts every casing convention real-world Claude Code projects use:
 *   PreToolUse.json
 *   pre-tool-use.json
 *   pre_tool_use.json
 *   pre-tool-use-1.json  (numeric suffix for multiple hooks per event)
 *   PreToolUse.docker.json
 */
function inferEventFromFilename(file: string): HookEvent | undefined {
  const base = file.replace(/\.json$/, '');
  // Strip a trailing -<digits> (multi-hook suffix) and any `.extra` segment.
  const cleaned = base.replace(/-[0-9]+$/, '').split('.')[0] ?? base;
  const normalised = cleaned.replace(/[-_]/g, '').toLowerCase();
  for (const event of ALL_EVENTS) {
    if (event.toLowerCase() === normalised) return event;
  }
  return undefined;
}

function isHookSpec(value: unknown): value is { handler: string; matcher?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { handler?: unknown }).handler === 'string'
  );
}

function cryptoRandom(): string {
  // We can't pull in `node:crypto.randomUUID` from a library you might
  // bundle for the browser one day. Use a simple non-secure id.
  return Math.random().toString(36).slice(2, 10);
}
