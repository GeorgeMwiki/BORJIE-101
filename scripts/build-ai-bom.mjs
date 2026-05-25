#!/usr/bin/env node
/**
 * Build the BORJIE AI Bill of Materials (AI BOM).
 *
 * Generates a signed-ready JSON document per Anthropic / NIST AI RMF /
 * EU AI Act Code of Practice (Aug 2026) expectations. The output
 * captures every LLM the platform invokes plus the prompt versions and
 * tool surface composed around them — so the operator can answer
 * "what's inside the AI?" with a single artifact.
 *
 * Output (stdout JSON + ai-bom.json on disk):
 *   - schema:               cyclonedx-1.6 + custom AI extensions
 *   - models[]:             one entry per provider/model used
 *   - systemCards[]:        BORJIE persona system cards (composition)
 *   - tools[]:              registered tool surface
 *   - datasetReferences[]:  training data (cited from provider model cards)
 *   - evalResults[]:        link to latest eval report (if present)
 *   - generatedAt, gitSha, repoRoot
 *
 * Designed to be signed downstream with `scripts/sign-ai-artifact.sh`
 * (cosign keyless OIDC via Sigstore Fulcio).
 *
 * Usage:
 *   node scripts/build-ai-bom.mjs               # writes to ai-bom.json
 *   node scripts/build-ai-bom.mjs --stdout      # also prints JSON
 *   node scripts/build-ai-bom.mjs --check       # exit 1 if model list drifted from last committed
 *
 * Refs:
 *   - https://www.cisa.gov/ai-bill-of-materials
 *   - https://www.nist.gov/itl/ai-risk-management-framework
 *   - EU AI Act, Annex XI (technical documentation for GPAI)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(REPO_ROOT, 'ai-bom.json');

const args = new Set(process.argv.slice(2));
const PRINT_STDOUT = args.has('--stdout');
const CHECK_MODE = args.has('--check');

// ---------------------------------------------------------------------------
// Static model catalog — every LLM BORJIE may invoke. Keep this in sync
// with the providers wired in `packages/ai-copilot/src/providers/`.
// ---------------------------------------------------------------------------

const MODELS = [
  {
    provider: 'anthropic',
    modelId: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7 (1M context)',
    tier: 'enterprise',
    trainingCutoff: '2026-01',
    contextWindow: 1_000_000,
    capabilities: ['reasoning', 'tool_use', 'vision', 'extended-thinking', 'prompt-caching'],
    modelCardUrl: 'https://docs.claude.com/en/docs/about-claude/models',
    intendedUse: 'deep-reasoning, multi-LLM synthesis judge',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    tier: 'growth',
    trainingCutoff: '2026-01',
    contextWindow: 200_000,
    capabilities: ['reasoning', 'tool_use', 'vision', 'prompt-caching'],
    modelCardUrl: 'https://docs.claude.com/en/docs/about-claude/models',
    intendedUse: 'default agent loop, persona dispatch',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    tier: 'free',
    trainingCutoff: '2025-10',
    contextWindow: 200_000,
    capabilities: ['tool_use', 'vision', 'prompt-caching'],
    modelCardUrl: 'https://docs.claude.com/en/docs/about-claude/models',
    intendedUse: 'cheap classification, judges, free-tier conversational',
  },
  {
    provider: 'openai',
    modelId: 'gpt-5',
    displayName: 'GPT-5',
    tier: 'enterprise',
    trainingCutoff: '2026-02',
    contextWindow: 400_000,
    capabilities: ['reasoning', 'tool_use', 'vision'],
    modelCardUrl: 'https://platform.openai.com/docs/models',
    intendedUse: 'second proposer in multi-LLM fan-out',
  },
  {
    provider: 'openai',
    modelId: 'gpt-realtime-2',
    displayName: 'GPT Realtime 2',
    tier: 'enterprise',
    trainingCutoff: '2026-01',
    contextWindow: 128_000,
    capabilities: ['voice', 'tool_use'],
    modelCardUrl: 'https://platform.openai.com/docs/models',
    intendedUse: 'Mr. Mwikila voice agent — sub-1s turn-taking',
  },
  {
    provider: 'deepseek',
    modelId: 'deepseek-v3',
    displayName: 'DeepSeek V3 / V3.5',
    tier: 'growth',
    trainingCutoff: '2025-12',
    contextWindow: 128_000,
    capabilities: ['reasoning', 'tool_use', 'batch'],
    modelCardUrl: 'https://api-docs.deepseek.com/',
    intendedUse: 'third proposer in fan-out, batch extraction, bulk classify',
  },
  {
    provider: 'elevenlabs',
    modelId: 'eleven_v3',
    displayName: 'ElevenLabs v3 Multilingual',
    tier: 'enterprise',
    capabilities: ['tts', 'multilingual:70+'],
    modelCardUrl: 'https://elevenlabs.io/docs/models',
    intendedUse: 'Swahili / Sheng / English voice synthesis',
  },
  {
    provider: 'lelapa',
    modelId: 'vulavula',
    displayName: 'Lelapa Vulavula',
    tier: 'growth',
    capabilities: ['stt', 'multilingual:swahili,luganda,zulu,xhosa'],
    modelCardUrl: 'https://lelapa.ai/',
    intendedUse: 'Sw/Lug STT — superior local quality vs Whisper',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function gitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function scanPersonaCount() {
  // Heuristic: count *.persona.ts and *.persona.json under packages/ to capture
  // BORJIE's actual deployed persona surface without hard-coding a list.
  try {
    const out = execSync(
      'find packages services -type f \\( -name "*.persona.ts" -o -name "*.persona.json" \\) | wc -l',
      { cwd: REPO_ROOT },
    )
      .toString()
      .trim();
    return Number.parseInt(out, 10) || 0;
  } catch {
    return 0;
  }
}

function scanToolRegistry() {
  // Heuristic: any file under packages/*/src/tools/ exporting a `name:` literal.
  try {
    const out = execSync(
      'grep -rh "^\\s*name:\\s*[\\x22\\x27]" packages/*/src/tools 2>/dev/null | wc -l',
      { cwd: REPO_ROOT, shell: '/bin/bash' },
    )
      .toString()
      .trim();
    return Number.parseInt(out, 10) || 0;
  } catch {
    return 0;
  }
}

function latestEvalReportPath() {
  // If `evals/` has a *.json report, use the most recent.
  const candidate = resolve(REPO_ROOT, 'evals', 'latest.json');
  return existsSync(candidate) ? 'evals/latest.json' : null;
}

// ---------------------------------------------------------------------------
// Build the BOM
// ---------------------------------------------------------------------------

const bom = {
  schema: 'cyclonedx-1.6+ai',
  bomFormat: 'AI-BOM',
  specVersion: '0.1.0',
  metadata: {
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    gitBranch: gitBranch(),
    repoRoot: REPO_ROOT,
    generator: 'scripts/build-ai-bom.mjs',
    licenseProfile: 'BORJIE-AUP-2026',
  },
  models: MODELS,
  systemCards: [
    {
      id: 'borjie-md',
      displayName: 'Mr. Mwikila (MD)',
      personaCount: scanPersonaCount(),
      modelRefs: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      synthesisStrategy: 'multi-llm-fanout-then-synth',
      constitutionRef: 'packages/autonomy-governance/src/constitution/borjie-constitution.ts',
      systemPromptDigest: 'computed-at-deploy-time',
    },
  ],
  tools: {
    registeredToolCount: scanToolRegistry(),
    mcpServers: [
      'packages/mcp-server',
      'services/mcp-server-firs',
      'services/mcp-server-nggis',
      'services/mcp-server-nin',
      'services/mcp-server-opay',
      'services/mcp-server-process-intel',
    ],
  },
  datasetReferences: [
    {
      note: 'Foundation-model training data composition is published only by the model providers in their respective model cards. BORJIE does not retrain these models. BORJIE-internal RAG corpora and fine-tunes are tracked under packages/database/src/seeds/.',
    },
  ],
  evalResults: {
    latestReportPath: latestEvalReportPath(),
    benchmarksTracked: ['BFCL-v4', 'Tau-Bench', 'internal/hallucination-guard', 'internal/judge-panel-5-rubric'],
  },
  governance: {
    constitutionVersion: 'v1',
    constitutionPath: 'packages/autonomy-governance/src/constitution/borjie-constitution.ts',
    autonomyCapPolicy: 'packages/autonomy-governance/src/caps/',
    auditTrailHashChain: true,
    rlsEnforced: true,
    asyncLocalStorageTenantIsolation: true,
  },
  compliance: {
    targetFrameworks: [
      'NIST AI RMF 2.0 + GenAI Profile',
      'ISO/IEC 42001 AIMS',
      'OWASP LLM Top 10 (2025)',
      'EU AI Act Annex XI (GPAI technical documentation)',
      'MITRE ATLAS',
    ],
    jurisdictions: ['TZ', 'KE', 'UG', 'NG', 'RW', 'ZA'],
  },
};

// ---------------------------------------------------------------------------
// --check mode: diff against last committed BOM. Exit 1 if drift.
// ---------------------------------------------------------------------------

function fingerprint(b) {
  // Stable fingerprint = sorted model IDs + system-card model refs + constitution ref.
  const modelIds = b.models.map((m) => `${m.provider}:${m.modelId}`).sort().join('|');
  const sysIds = b.systemCards.map((s) => `${s.id}:${s.modelRefs.sort().join(',')}`).sort().join('|');
  return `${modelIds}__${sysIds}__${b.governance.constitutionVersion}`;
}

if (CHECK_MODE) {
  if (!existsSync(OUT_PATH)) {
    console.error('[ai-bom] --check: ai-bom.json missing; run without --check to generate it first.');
    process.exit(2);
  }
  const previous = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  const drift = fingerprint(previous) !== fingerprint(bom);
  if (drift) {
    console.error('[ai-bom] DRIFT DETECTED:');
    console.error('  previous:', fingerprint(previous));
    console.error('  current :', fingerprint(bom));
    console.error('  → regenerate with `node scripts/build-ai-bom.mjs` and commit.');
    process.exit(1);
  }
  console.log('[ai-bom] OK — fingerprint matches committed ai-bom.json');
  process.exit(0);
}

writeFileSync(OUT_PATH, JSON.stringify(bom, null, 2) + '\n');
console.log(`[ai-bom] wrote ${OUT_PATH}`);
console.log(`[ai-bom]   models=${bom.models.length} system-cards=${bom.systemCards.length} tools≈${bom.tools.registeredToolCount}`);
console.log(`[ai-bom]   fingerprint=${fingerprint(bom)}`);

if (PRINT_STDOUT) {
  console.log('---BOM---');
  console.log(JSON.stringify(bom, null, 2));
}
