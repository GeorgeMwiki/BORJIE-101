/**
 * Layer 1 — inline `code-reviewer` subagent.
 *
 * Runs in-process before the PR is opened. Uses the K-C `code-reviewer`
 * subagent pattern: read-only tools, severity-ranked findings with
 * file:line refs.
 *
 * This file is a thin orchestrator; the actual subagent invocation is
 * provided by the caller (see `runWithSubagent`) so we don't hard-depend
 * on the SDK in this package.
 */

import {
  type ICodeReviewer,
  type ReviewFinding,
  type ReviewInput,
  type ReviewVerdict,
} from './types.js';

export type InlineSubagentRunner = (
  prompt: string,
  context: { diff: string; modifiedFiles: readonly string[] },
) => Promise<{ findings: readonly ReviewFinding[] }>;

const INLINE_REVIEWER_PROMPT = `You are the BORJIE \`code-reviewer\` subagent.
Tools allowed: Read, Grep, Glob, Bash (read-only).
Tools FORBIDDEN: Edit, Write, Delete.

Review the supplied diff for:
1. OWASP top-10 risks (esp. injection, SSRF, secrets in logs).
2. SECURITY.md compliance (mTLS, audit-logged actions).
3. Multi-tenant correctness — every query/mutation MUST filter by tenant_id.
4. Currency/jurisdiction defaults — never hard-code.
5. Immutability — no in-place mutation in domain logic.
6. Test coverage — does each new branch have a test?

Output: an array of findings, each with file, line, severity (info|warning|
error|critical), and a single-sentence message. Aim for signal-to-noise
ratio above 9:1.`;

export class InlineSubagentReviewer implements ICodeReviewer {
  public readonly name = 'inline-subagent';
  private readonly runner: InlineSubagentRunner;

  public constructor(runner: InlineSubagentRunner) {
    this.runner = runner;
  }

  public async review(input: ReviewInput): Promise<ReviewVerdict> {
    const { findings } = await this.runner(INLINE_REVIEWER_PROMPT, {
      diff: input.diff,
      modifiedFiles: input.modifiedFiles,
    });
    return Object.freeze<ReviewVerdict>({
      status: classifyFindings(findings),
      findings: Object.freeze([...findings]),
      layer: 'inline-subagent',
    });
  }
}

export function classifyFindings(
  findings: readonly ReviewFinding[],
): 'pass' | 'comments' | 'block' {
  if (findings.length === 0) return 'pass';
  if (findings.some((f) => f.severity === 'critical')) return 'block';
  return 'comments';
}
