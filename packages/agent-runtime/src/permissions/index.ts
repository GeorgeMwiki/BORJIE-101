/**
 * Permission engine — three modes on top of allow/deny rule lists.
 *
 * Per the 2026 Claude Agent SDK contract:
 *
 *   - Deny rules always win over allow rules.
 *   - The settings hierarchy is `enterprise > user > project > runtime`
 *     for ALLOW, the same order for DENY (a higher-tier deny cannot be
 *     overridden by a lower-tier allow).
 *
 * Three modes:
 *
 *   strict      Default-deny. Only explicit allow rules pass.
 *               Best for production / autonomous loops.
 *   open        Default-allow. Only explicit deny rules block.
 *               Mirrors Claude Code `acceptEdits` mode for trusted ops.
 *   audit-only  Always allow, but every check is logged to the audit
 *               sink. Best for migration windows where you're moving
 *               from open to strict and want a baseline.
 *
 * Rule shape mirrors Claude Code:
 *
 *   "Read"                       — any Read tool call
 *   "Bash(git status:*)"         — Bash where args.command matches the pattern
 *   "Edit(*.md)"                 — Edit where args.path matches the pattern
 *
 * Arg patterns are `glob → RegExp` with `*` ⇒ `.*` and `?` ⇒ `.`.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  PermissionAuditEntry,
  PermissionCheck,
  PermissionConfig,
  PermissionDecision,
  PermissionMode,
  PermissionRule,
  RuntimeLogger,
} from '../types.js';
import { noopLogger } from '../types.js';
import type {
  AgentSecurityGuard,
  GuardToolCall,
} from '../security-guard/index.js';

export interface PermissionEngineOptions {
  readonly projectPath: string;
  readonly userScopePath?: string;
  readonly enterpriseScopePath?: string;
  readonly defaultMode?: PermissionMode;
  readonly logger?: RuntimeLogger;
  /** Optional audit sink — defaults to a bounded in-memory ring buffer. */
  readonly auditSink?: (entry: PermissionAuditEntry) => void;
  /**
   * SEC-G1 — optional agent-security-guard. When wired, `checkToolCall`
   * runs the rule-list decision AND the guard (authority-tier / recursion /
   * confirmation), taking the STRICTER of the two. Absent (the default) the
   * engine behaves exactly as before — pure additive activation.
   */
  readonly securityGuard?: AgentSecurityGuard;
}

/** Per-call context the guard needs beyond the bare tool name + args. */
export interface GuardedToolContext {
  readonly callerTier?: GuardToolCall['callerTier'];
  readonly confirmed?: boolean;
  readonly callDepth?: number;
  readonly siblingsAtThisDepth?: number;
  readonly tenantId: string;
  readonly agentKind: string;
}

/** Combined decision: the stricter of the rule-list and the guard. */
export interface GuardedPermissionDecision {
  readonly decision: PermissionDecision;
  /** Which layer produced the binding (strictest) decision. */
  readonly source: 'rules' | 'guard';
  readonly rationale?: string;
}

const RULE_RE = /^([A-Za-z][\w-]*)(?:\(([^)]*)\))?$/;

export class PermissionEngine {
  readonly #projectPath: string;
  readonly #userScopePath: string | undefined;
  readonly #enterpriseScopePath: string | undefined;
  readonly #logger: RuntimeLogger;
  readonly #auditSink: (e: PermissionAuditEntry) => void;
  readonly #audit: PermissionAuditEntry[] = [];
  readonly #securityGuard: AgentSecurityGuard | undefined;
  static readonly #AUDIT_CAP = 1024;

  #config: PermissionConfig;

  constructor(opts: PermissionEngineOptions) {
    this.#projectPath = opts.projectPath;
    this.#userScopePath = opts.userScopePath;
    this.#enterpriseScopePath = opts.enterpriseScopePath;
    this.#securityGuard = opts.securityGuard;
    this.#logger = opts.logger ?? noopLogger;
    this.#auditSink =
      opts.auditSink ??
      ((entry) => {
        this.#audit.push(entry);
        if (this.#audit.length > PermissionEngine.#AUDIT_CAP) {
          this.#audit.shift();
        }
      });
    this.#config = Object.freeze({
      mode: opts.defaultMode ?? 'strict',
      allow: Object.freeze([]),
      deny: Object.freeze([]),
    });
  }

  /**
   * Loads `.claude/settings.json` in enterprise → user → project order
   * (lower-priority files load first; deny rules from any of them
   * cannot be overridden by an allow in a later file).
   */
  async loadPermissionRules(): Promise<PermissionConfig> {
    const allow: PermissionRule[] = [];
    const deny: PermissionRule[] = [];
    const ask: PermissionRule[] = [];
    let mode: PermissionMode = this.#config.mode;

    const files: Array<{ path: string; source: PermissionRule['source'] }> = [];
    if (this.#enterpriseScopePath !== undefined) {
      files.push({
        path: join(this.#enterpriseScopePath, 'settings.json'),
        source: 'enterprise',
      });
    }
    if (this.#userScopePath !== undefined) {
      files.push({ path: join(this.#userScopePath, 'settings.json'), source: 'user' });
    }
    files.push({
      path: join(this.#projectPath, '.claude', 'settings.json'),
      source: 'project',
    });
    files.push({
      path: join(this.#projectPath, '.claude', 'settings.local.json'),
      source: 'project',
    });

    for (const { path, source } of files) {
      if (!existsSync(path)) continue;
      try {
        const raw = await readFile(path, 'utf8');
        const parsed = JSON.parse(raw) as {
          permissions?: {
            mode?: PermissionMode;
            allow?: ReadonlyArray<string>;
            deny?: ReadonlyArray<string>;
            ask?: ReadonlyArray<string>;
          };
        };
        const p = parsed.permissions;
        if (p === undefined) continue;
        if (p.mode !== undefined) mode = p.mode;
        for (const r of p.allow ?? []) allow.push({ rule: r, source });
        for (const r of p.deny ?? []) deny.push({ rule: r, source });
        for (const r of p.ask ?? []) ask.push({ rule: r, source });
      } catch (err) {
        this.#logger.log('warn', `agent-runtime: failed to load ${path}`, {
          error: (err as Error).message,
        });
      }
    }

    this.#config = Object.freeze({
      mode,
      allow: Object.freeze([...allow]),
      deny: Object.freeze([...deny]),
      ask: Object.freeze([...ask]),
    });
    return this.#config;
  }

  /** Force-set the runtime mode (e.g. flipping into audit-only). */
  setMode(mode: PermissionMode): void {
    this.#config = Object.freeze({ ...this.#config, mode });
  }

  getConfig(): PermissionConfig {
    return this.#config;
  }

  /**
   * Resolves a permission decision per the matrix:
   *
   *   audit-only     → ALWAYS allow, log
   *   strict + deny  → deny
   *   strict + allow → allow
   *   strict + ask   → ask
   *   strict + none  → deny
   *   open + deny    → deny
   *   open + ask     → ask  (explicit ask still gates in open mode)
   *   open + none    → allow
   */
  checkPermission(check: PermissionCheck): PermissionDecision {
    const cfg = this.#config;
    let decision: PermissionDecision;
    let matchedRule: string | undefined;

    const denyMatch = firstMatch(cfg.deny, check);
    if (denyMatch !== undefined) {
      decision = 'deny';
      matchedRule = denyMatch.rule;
    } else if (cfg.mode === 'audit-only') {
      decision = 'allow';
      matchedRule = '(audit-only)';
    } else {
      const allowMatch = firstMatch(cfg.allow, check);
      const askMatch = firstMatch(cfg.ask ?? [], check);
      if (askMatch !== undefined && allowMatch === undefined) {
        decision = 'ask';
        matchedRule = askMatch.rule;
      } else if (allowMatch !== undefined) {
        decision = 'allow';
        matchedRule = allowMatch.rule;
      } else {
        decision = cfg.mode === 'strict' ? 'deny' : 'allow';
      }
    }

    this.#auditSink(
      Object.freeze({
        timestamp: new Date().toISOString(),
        tool: check.tool,
        decision,
        mode: cfg.mode,
        ...(matchedRule !== undefined ? { matchedRule } : {}),
      }),
    );
    return decision;
  }

  /** True iff an agent-security-guard is wired (SEC-G1 active). */
  hasSecurityGuard(): boolean {
    return this.#securityGuard !== undefined;
  }

  /**
   * SEC-G1 — combined tool-call gate.
   *
   * Runs the rule-list `checkPermission` AND (when wired) the
   * agent-security-guard, returning the STRICTER decision
   * (`deny > ask > allow`). The guard can only ever NARROW — it never
   * upgrades a rule-list `deny` to `allow`. When no guard is wired this is
   * identical to `checkPermission`, so it is a safe drop-in.
   *
   * `ctx` supplies the authority tier / recursion depth / confirmation the
   * rule list does not know about; the caller (the loop runner) threads it
   * from the live agent context.
   */
  checkToolCall(
    check: PermissionCheck,
    ctx: GuardedToolContext,
  ): GuardedPermissionDecision {
    const ruleDecision = this.checkPermission(check);
    const guard = this.#securityGuard;
    if (guard === undefined) {
      return Object.freeze({ decision: ruleDecision, source: 'rules' });
    }
    // A rule-list `deny` already blocks; the guard cannot widen it, so skip
    // the guard work (and avoid recording a redundant violation) on deny.
    if (ruleDecision === 'deny') {
      return Object.freeze({
        decision: 'deny' as const,
        source: 'rules' as const,
      });
    }
    let guardDecision;
    try {
      guardDecision = guard.checkToolCall({
        toolName: check.tool,
        args: check.args ?? {},
        ...(ctx.callerTier !== undefined ? { callerTier: ctx.callerTier } : {}),
        ...(ctx.confirmed !== undefined ? { confirmed: ctx.confirmed } : {}),
        ...(ctx.callDepth !== undefined ? { callDepth: ctx.callDepth } : {}),
        ...(ctx.siblingsAtThisDepth !== undefined
          ? { siblingsAtThisDepth: ctx.siblingsAtThisDepth }
          : {}),
        tenantId: ctx.tenantId,
        agentKind: ctx.agentKind,
      });
    } catch (err) {
      // Fail-closed: a guard that throws denies the call (never widens to the
      // rule-list allow). This is the meta-rail — the agent can never bypass
      // it via a guard crash.
      this.#logger.log(
        'error',
        'agent-runtime: security-guard threw — failing closed (deny)',
        {
          error: err instanceof Error ? err.message : String(err),
          tool: check.tool,
        },
      );
      return Object.freeze({
        decision: 'deny' as const,
        source: 'guard' as const,
        rationale: 'security-guard error (fail-closed)',
      });
    }
    // Pick the stricter: deny > ask > allow.
    const rank: Record<PermissionDecision, number> = {
      deny: 2,
      ask: 1,
      allow: 0,
    };
    if (rank[guardDecision.decision] > rank[ruleDecision]) {
      return Object.freeze({
        decision: guardDecision.decision,
        source: 'guard' as const,
        rationale: guardDecision.rationale,
      });
    }
    return Object.freeze({ decision: ruleDecision, source: 'rules' });
  }

  /** Drains the in-memory audit ring buffer. */
  drainAudit(): ReadonlyArray<PermissionAuditEntry> {
    const out = Object.freeze([...this.#audit]);
    this.#audit.length = 0;
    return out;
  }
}

// ─────────────────────────────────────────────────────────────────
// Rule matching
// ─────────────────────────────────────────────────────────────────

function firstMatch(
  rules: ReadonlyArray<PermissionRule>,
  check: PermissionCheck,
): PermissionRule | undefined {
  for (const r of rules) {
    if (matchesRule(r.rule, check)) return r;
  }
  return undefined;
}

export function matchesRule(rule: string, check: PermissionCheck): boolean {
  const parsed = RULE_RE.exec(rule.trim());
  if (parsed === null) return false;
  const [, tool, argPattern] = parsed;
  if (tool !== check.tool) return false;
  if (argPattern === undefined || argPattern.length === 0) return true;
  return matchesArgPattern(argPattern, check.args ?? {});
}

function matchesArgPattern(
  pattern: string,
  args: Readonly<Record<string, unknown>>,
): boolean {
  // Claude Code's parenthesised arg pattern uses TWO conventions:
  //
  //   Bash(git status:*)   ← "prefix : glob-of-the-tail"
  //   Edit(*.md)           ← "plain glob over the first string arg"
  //
  // We detect the first form by the presence of an UNESCAPED `:`.
  // Anything before the `:` is a literal prefix; the part after is
  // the tail glob that follows that prefix.
  const candidates: string[] = [];
  for (const v of Object.values(args)) {
    if (typeof v === 'string') candidates.push(v);
  }
  if (candidates.length === 0) return false;
  const colonIdx = pattern.indexOf(':');
  if (colonIdx === -1) {
    const re = globToRegExp(pattern);
    return candidates.some((c) => re.test(c));
  }
  const prefix = pattern.slice(0, colonIdx);
  const tailGlob = pattern.slice(colonIdx + 1);
  // `Bash(git status:)` means "exactly the prefix, no tail".
  if (tailGlob.length === 0) {
    return candidates.some((c) => c === prefix);
  }
  const tailRe = globToRegExp(tailGlob);
  return candidates.some((c) => {
    if (!c.startsWith(prefix)) return false;
    const tail = c.slice(prefix.length).trimStart();
    return tailRe.test(tail);
  });
}

export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (const ch of glob) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if (/[.+^${}()|[\]\\]/.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`);
}
