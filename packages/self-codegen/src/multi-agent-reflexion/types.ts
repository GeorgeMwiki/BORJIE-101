/**
 * Multi-agent Reflexion types.
 *
 * Pattern #7 from R-CODEGEN: three critics with distinct system prompts
 * (factual / senior-eng / security) avoid the local-optima trap that
 * single-agent Reflexion falls into.
 */

export type CriticName = 'factual' | 'senior-eng' | 'security';

export interface CriticVerdict {
  readonly critic: CriticName;
  readonly status: 'pass' | 'comments' | 'block';
  readonly findings: readonly {
    readonly severity: 'info' | 'warning' | 'error' | 'critical';
    readonly file?: string;
    readonly line?: number;
    readonly message: string;
  }[];
}

export interface DraftToReflect {
  readonly diffSummary: string;
  readonly modifiedFiles: readonly string[];
}

export interface ReflexionRoundRequest {
  readonly draft: DraftToReflect;
  readonly critics: readonly CriticName[];
  readonly reviewer: (input: {
    diffSummary: string;
    modifiedFiles: readonly string[];
    critic?: CriticName;
  }) => Promise<{
    verdict: 'pass' | 'comments' | 'block';
    findings: readonly {
      severity: 'info' | 'warning' | 'error' | 'critical';
      file?: string;
      line?: number;
      message: string;
    }[];
  }>;
}

export interface ReflexionResult {
  readonly verdict: 'pass' | 'comments' | 'block';
  readonly findings: readonly {
    readonly critic: CriticName;
    readonly severity: 'info' | 'warning' | 'error' | 'critical';
    readonly file?: string;
    readonly line?: number;
    readonly message: string;
  }[];
  readonly perCritic: readonly CriticVerdict[];
}

export const CRITIC_SYSTEM_PROMPTS: Record<CriticName, string> = {
  factual: [
    'You are the FACTUAL critic. Your job is to verify the diff matches',
    'the plan claimed in the PR body, that quoted facts (file paths, line',
    'counts, library names) are correct, and that test names match what',
    'the diff actually exercises. Flag drift between plan and execution.',
  ].join(' '),
  'senior-eng': [
    'You are the SENIOR ENGINEERING critic. Look for: code smell, missing',
    'edge cases, broken abstractions, accidental complexity, performance',
    'regressions, missing tests for new branches. Apply Refactoring UI and',
    'Rams principles where applicable. Be concise but ruthless.',
  ].join(' '),
  security: [
    'You are the SECURITY critic. Look for: secrets in code, missing',
    'tenant_id filters, timing leaks, SSRF, injection, missing input',
    'validation, weak crypto, broken authn/authz, audit-log gaps. Flag',
    'anything that touches m-pesa, payments-ledger, or migrations.',
  ].join(' '),
};
