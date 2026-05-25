/**
 * Master Brain chat mocks.
 *
 * Used when the gateway SSE channel is unreachable so the chat surface
 * always demonstrates the streaming + evidence-pill + breadcrumb UX.
 *
 * The shape (turn / message / evidence / breadcrumb) matches what the
 * gateway will send, so the real client wires up to the same renderer.
 */

import type { CeoModeId } from '@/lib/ceo-modes';

export interface ChatEvidence {
  readonly id: string;
  readonly label: string;
  readonly docTitle: string;
  readonly excerpt: string;
  readonly page?: number;
}

export interface ChatBreadcrumb {
  readonly agent: string;
  readonly action: string;
  readonly latencyMs: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'owner' | 'master-brain';
  readonly content: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly breadcrumbs: ReadonlyArray<ChatBreadcrumb>;
  readonly mode: CeoModeId;
  readonly createdAt: string;
}

export const MOCK_EVIDENCE_LIBRARY: ReadonlyArray<ChatEvidence> = [
  {
    id: 'ev_pml25434',
    label: 'PML 25434 §3.2',
    docTitle: 'PML 25434 — Nyakabale Reef Block',
    excerpt:
      'The licensee shall pay annual rent of TZS 1,200,000 within 30 days of the renewal anchor date. Failure triggers a 25% surcharge and the dormancy clock per Mining Act 2010 §44.',
    page: 4,
  },
  {
    id: 'ev_cockpit_cash',
    label: 'Cockpit · cash',
    docTitle: 'Live ledger snapshot',
    excerpt: 'Cash on hand TZS 412.6M · 30-day burn TZS 5.8M/day · runway 71 days.',
  },
  {
    id: 'ev_strategy_sim',
    label: 'Strategy simulator v0.2',
    docTitle: 'Capital allocation forecaster',
    excerpt:
      'Lease scenario — TZS 18M/mo for 24mo — drops runway 71→52d under flat gold price. Break-even reached month 9.',
  },
  {
    id: 'ev_bot_fx',
    label: 'BoT FX circular 27-Mar',
    docTitle: 'Bank of Tanzania FX directive',
    excerpt:
      'From 27 March 2026 all USD receivables must convert to TZS at the BoT mid within 14 days of receipt.',
    page: 2,
  },
];

export const SAMPLE_TRANSCRIPT: ReadonlyArray<ChatMessage> = [
  {
    id: 'msg_001',
    role: 'owner',
    content:
      'Tukiamua kununua excavator ya pili sasa, runway itakuwaje kwa miezi sita?',
    evidenceIds: [],
    breadcrumbs: [],
    mode: 'strategy',
    createdAt: '2026-05-25T06:14:00Z',
  },
  {
    id: 'msg_002',
    role: 'master-brain',
    content:
      'Pamoja na lease ya miezi 24 kwa TZS 18M/mwezi, runway inashuka kutoka siku 71 hadi 52. Inashauriwa kusubiri Q3 baada ya kuuza Nyakabale stockpile — basi cash itapanda hadi TZS 540M na lease haitabadilisha runway chini ya 60.',
    evidenceIds: ['ev_cockpit_cash', 'ev_strategy_sim'],
    breadcrumbs: [
      { agent: 'StrategyMode', action: 'capital_alloc.simulate', latencyMs: 412 },
      { agent: 'ForecasterAgent', action: 'runway.project_90d', latencyMs: 188 },
      { agent: 'CostEngineer', action: 'lease.amortise', latencyMs: 96 },
    ],
    mode: 'strategy',
    createdAt: '2026-05-25T06:14:08Z',
  },
];

/**
 * Mock SSE stream — used by the chat panel when the gateway is
 * unreachable. Emits a small breadcrumb run, a chunked text reply, an
 * evidence list, then a `done` sentinel.
 */
export async function* mockChatStream(
  prompt: string,
  mode: CeoModeId,
): AsyncGenerator<{ event: string; data: unknown }> {
  const reply = buildMockReply(prompt, mode);
  yield {
    event: 'breadcrumb',
    data: { agent: 'MasterBrain', action: 'route', latencyMs: 38 },
  };
  await delay(80);
  yield {
    event: 'breadcrumb',
    data: {
      agent: modeAgentName(mode),
      action: 'plan',
      latencyMs: 142,
    },
  };
  for (const chunk of chunkText(reply, 24)) {
    await delay(40);
    yield { event: 'delta', data: { text: chunk } };
  }
  yield {
    event: 'evidence',
    data: { ids: pickEvidenceForMode(mode) },
  };
  yield {
    event: 'breadcrumb',
    data: { agent: 'EvidenceAgent', action: 'gather', latencyMs: 73 },
  };
  yield { event: 'done', data: { id: `msg_${Date.now()}` } };
}

function modeAgentName(mode: CeoModeId): string {
  const map: Record<CeoModeId, string> = {
    build: 'BuildMode',
    strategy: 'StrategyMode',
    operations: 'OperationsMode',
    document: 'DocumentMode',
    finance: 'FinanceMode',
    risk: 'RiskMode',
    board: 'BoardMode',
    compliance: 'ComplianceMode',
  };
  return map[mode];
}

function pickEvidenceForMode(mode: CeoModeId): ReadonlyArray<string> {
  if (mode === 'finance' || mode === 'strategy')
    return ['ev_cockpit_cash', 'ev_strategy_sim'];
  if (mode === 'document' || mode === 'compliance') return ['ev_pml25434'];
  if (mode === 'risk') return ['ev_bot_fx', 'ev_cockpit_cash'];
  return ['ev_cockpit_cash'];
}

function buildMockReply(prompt: string, mode: CeoModeId): string {
  const intros: Record<CeoModeId, string> = {
    build: 'In Build mode I will scaffold this structurally.',
    strategy:
      'Strategy view: portfolio expected free cash flow shifts as follows.',
    operations: 'Operational read across the 3 active sites:',
    document: 'Document mode — every claim cites the source bbox.',
    finance: 'Finance simulation against today\'s burn and FX exposure:',
    risk: 'Risk scan across licences, safety, community and FX:',
    board: 'For external audiences, here is the cleaned narrative:',
    compliance: 'Compliance check against the Mining Act 2010 and BoT directives:',
  };
  return `${intros[mode]} ${truncate(prompt, 120)}\n\nProvisional answer with evidence — the live brain will replace this with a grounded simulation as soon as the gateway is reachable.`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function chunkText(text: string, size: number): ReadonlyArray<string> {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
