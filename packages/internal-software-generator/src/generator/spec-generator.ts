/**
 * Spec generator — port + heuristic seed.
 *
 * ON_DEMAND_INTERNAL_SOFTWARE_SPEC §3: the spec generator turns a
 * free-form owner utterance into a `DraftTool` (kind + name + spec +
 * authority tier).
 *
 * This module declares the port interface; the actual LLM call is
 * injected by the composition root. We also ship a deterministic
 * heuristic implementation for tests + CI smoke runs: it parses the
 * utterance for a small dictionary of verbs and entities and emits a
 * plausible (but admittedly naive) spec. The heuristic generator is
 * NOT a production substitute — it exists so the lifecycle + runner
 * tests don't need an LLM dependency.
 */

import type {
  AuthorityTier,
  DraftTool,
  GenerateToolRequest,
  ToolKind,
  ToolSpec,
} from '../types.js';
import { assertValidToolSpec } from '../spec/spec-validator.js';

/**
 * The port. Production binds this to an LLM-driven generator
 * (Sonnet 4.7 / Opus 4.7 per spec §3); tests pass `heuristicSpecGenerator`.
 */
export type SpecGeneratorPort = (
  request: GenerateToolRequest,
) => Promise<DraftTool>;

// ---------------------------------------------------------------------------
// Heuristic seed implementation
// ---------------------------------------------------------------------------

const VERB_TO_KIND: ReadonlyArray<{
  readonly verbs: ReadonlyArray<string>;
  readonly kind: ToolKind;
}> = [
  { verbs: ['report', 'summarise', 'summarize'], kind: 'report' },
  { verbs: ['workflow', 'automate', 'route'], kind: 'workflow' },
  { verbs: ['dashboard', 'visualise', 'visualize', 'chart'], kind: 'dashboard' },
  { verbs: ['scan', 'extract', 'find'], kind: 'extractor' },
  { verbs: ['watch', 'alert', 'notify'], kind: 'watcher' },
];

const MUTATING_VERBS: ReadonlySet<string> = new Set([
  'create',
  'update',
  'delete',
  'mutate',
  'change',
  'modify',
  'archive',
  'close',
  'open',
  'send',
  'fire',
]);

/**
 * Deterministic heuristic generator. Produces a DraftTool that
 * validates cleanly against the shape contract. Useful for tests +
 * smoke runs without an LLM in the loop.
 */
export const heuristicSpecGenerator: SpecGeneratorPort = async (request) => {
  const utterance = request.ownerUtterance.toLowerCase();
  const kind = request.desiredKind ?? inferKind(utterance);
  const isMutating = containsAny(utterance, MUTATING_VERBS);
  const authorityTier: AuthorityTier = isMutating ? 'T2' : 'T1';

  const rawSpec = {
    form: {
      title: `Run ${kind} — ${truncate(request.ownerUtterance, 60)}`,
      fields: [
        {
          name: 'scope',
          label: 'Scope (e.g. site, district)',
          kind: 'text' as const,
          required: true,
        },
        {
          name: 'window_days',
          label: 'Lookback window (days)',
          kind: 'number' as const,
          required: true,
        },
      ],
    },
    handler: {
      handlerId: `auto.${kind}.${hashUtterance(request.ownerUtterance)}`,
      readsFields: ['scope', 'window_days'],
      readsSources: inferReadSources(utterance),
      writesSources: isMutating ? inferWriteSources(utterance) : [],
    },
    archetype: pickArchetype(kind),
    auditHook: {
      enabled: true,
      redactFields: [] as ReadonlyArray<string>,
    },
  };

  const spec: ToolSpec = assertValidToolSpec(rawSpec);

  return {
    name: deriveName(request.ownerUtterance, kind),
    kind,
    spec,
    authorityTier,
  };
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function inferKind(utterance: string): ToolKind {
  for (const entry of VERB_TO_KIND) {
    for (const verb of entry.verbs) {
      if (utterance.includes(verb)) {
        return entry.kind;
      }
    }
  }
  return 'report';
}

function inferReadSources(utterance: string): ReadonlyArray<string> {
  const sources: string[] = [];
  if (utterance.includes('shift') || utterance.includes('worker')) {
    sources.push('worker_shifts');
  }
  if (utterance.includes('safety')) {
    sources.push('safety_events');
  }
  if (utterance.includes('royalty') || utterance.includes('finance')) {
    sources.push('treasury_ledger');
  }
  if (utterance.includes('production') || utterance.includes('yield')) {
    sources.push('production_runs');
  }
  if (sources.length === 0) {
    sources.push('generic_corpus');
  }
  return sources;
}

function inferWriteSources(utterance: string): ReadonlyArray<string> {
  // Conservative: writes are only declared for explicit mutate-style
  // language. Default is a generic side-effect bucket.
  if (utterance.includes('notify') || utterance.includes('send')) {
    return ['outbox'];
  }
  return ['tool_side_effects'];
}

function pickArchetype(kind: ToolKind) {
  switch (kind) {
    case 'dashboard':
      return 'kpi-grid' as const;
    case 'report':
      return 'table' as const;
    case 'workflow':
      return 'list-with-detail' as const;
    case 'extractor':
      return 'detail-card' as const;
    case 'watcher':
      return 'time-series-chart' as const;
  }
}

function deriveName(utterance: string, kind: ToolKind): string {
  const snippet = truncate(utterance.replace(/[^a-z0-9\s]+/gi, ' '), 80);
  return `${kind}: ${snippet}`;
}

function truncate(s: string, n: number): string {
  const trimmed = s.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= n) {
    return trimmed;
  }
  return `${trimmed.slice(0, n - 1)}…`;
}

function containsAny(s: string, words: ReadonlySet<string>): boolean {
  for (const w of words) {
    if (s.includes(w)) {
      return true;
    }
  }
  return false;
}

function hashUtterance(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
