/**
 * Borjie Console — Internal admin screen registry (I-W-01 to I-W-20).
 *
 * Single source of truth: dashboard cards, sub-nav groups, breadcrumbs
 * and individual stub pages all derive their copy from this manifest.
 * Mirrors UI_SCREEN_CATALOGUE.md §D — keep the two files in lockstep.
 */

export type ScreenGroup = 'tenants' | 'intelligence' | 'quality' | 'ops';

export interface InternalScreen {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly intent: string;
  readonly group: ScreenGroup;
}

export const INTERNAL_SCREENS: ReadonlyArray<InternalScreen> = [
  {
    id: 'I-W-01',
    slug: 'tenants',
    title: 'Tenant directory',
    intent: 'Sign-up, plan, billing, lifecycle.',
    group: 'tenants',
  },
  {
    id: 'I-W-02',
    slug: 'tenants/detail',
    title: 'Tenant detail',
    intent: 'Live ops view; can impersonate (audited).',
    group: 'tenants',
  },
  {
    id: 'I-W-03',
    slug: 'corpus',
    title: 'Intelligence corpus management',
    intent:
      'Upload new research / minerals dossiers, supersede entries, version-bump, re-ingest.',
    group: 'intelligence',
  },
  {
    id: 'I-W-04',
    slug: 'citations',
    title: 'Citation library',
    intent: 'Every TZ regulation indexed; gazette ingest pipeline.',
    group: 'intelligence',
  },
  {
    id: 'I-W-05',
    slug: 'prompts',
    title: 'Prompt registry',
    intent: 'Per-junior system prompts; GEPA scoreboard; promotion log.',
    group: 'intelligence',
  },
  {
    id: 'I-W-06',
    slug: 'models',
    title: 'Model registry',
    intent:
      'Which Anthropic / Cohere / Whisper model per junior; cost / latency dashboards.',
    group: 'intelligence',
  },
  {
    id: 'I-W-07',
    slug: 'juniors',
    title: 'Junior catalogue',
    intent: 'Provision / suspend / revoke template juniors.',
    group: 'intelligence',
  },
  {
    id: 'I-W-08',
    slug: 'ab-tests',
    title: 'A/B test harness',
    intent: 'Run new prompt against golden set + canary tenants.',
    group: 'quality',
  },
  {
    id: 'I-W-09',
    slug: 'decision-log',
    title: 'Decision-log auditor',
    intent: 'Per-tenant recommendation history with evidence chains.',
    group: 'quality',
  },
  {
    id: 'I-W-10',
    slug: 'audit-log',
    title: 'Audit-log viewer',
    intent: 'Append-only event log per tenant.',
    group: 'quality',
  },
  {
    id: 'I-W-11',
    slug: 'slo',
    title: 'SLO dashboard',
    intent: 'Latency, error, model-spend per tenant per junior.',
    group: 'quality',
  },
  {
    id: 'I-W-12',
    slug: 'flags',
    title: 'Feature-flag controls',
    intent: 'Per-tenant roll-out.',
    group: 'ops',
  },
  {
    id: 'I-W-13',
    slug: 'regulator-pipeline',
    title: 'Regulator-change pipeline',
    intent: 'New Gazette / NEMC / BoT → review queue → corpus push.',
    group: 'intelligence',
  },
  {
    id: 'I-W-14',
    slug: 'marketplace',
    title: 'Marketplace moderation',
    intent: 'Listings, ratings, disputes.',
    group: 'ops',
  },
  {
    id: 'I-W-15',
    slug: 'compliance-queue',
    title: 'Compliance review queue',
    intent: 'Manual-approval gates the Compliance Agent escalates.',
    group: 'ops',
  },
  {
    id: 'I-W-16',
    slug: 'support',
    title: 'Support tickets & escalations',
    intent: 'Per-tenant CSAT, ticket SLA.',
    group: 'ops',
  },
  {
    id: 'I-W-17',
    slug: 'audit-pack',
    title: 'Regulator audit-pack issuer',
    intent: 'Mint expiring signed URLs.',
    group: 'ops',
  },
  {
    id: 'I-W-18',
    slug: 'analytics',
    title: 'Onboarding / churn analytics',
    intent: 'Funnel + cohort.',
    group: 'tenants',
  },
  {
    id: 'I-W-19',
    slug: 'rollback',
    title: 'Roll-back panel',
    intent: 'One-click revert of any promoted prompt / model / corpus version.',
    group: 'ops',
  },
  {
    id: 'I-W-20',
    slug: 'killswitch',
    title: 'Killswitch controls',
    intent: 'Env vars HALT / DEGRADED per junior, per tenant.',
    group: 'ops',
  },
];

export interface ScreenGroupDescriptor {
  readonly id: ScreenGroup;
  readonly label: string;
  readonly blurb: string;
}

export const SCREEN_GROUPS: ReadonlyArray<ScreenGroupDescriptor> = [
  {
    id: 'tenants',
    label: 'Tenants',
    blurb: 'Directory, live ops, lifecycle analytics.',
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    blurb: 'Corpus, citations, prompts, models, juniors, regulator pipeline.',
  },
  {
    id: 'quality',
    label: 'Quality',
    blurb: 'A/B, decision logs, audit logs, SLOs.',
  },
  {
    id: 'ops',
    label: 'Ops',
    blurb: 'Flags, marketplace, compliance, support, audit packs, rollbacks, killswitch.',
  },
];

export function screensByGroup(group: ScreenGroup): ReadonlyArray<InternalScreen> {
  return INTERNAL_SCREENS.filter((screen) => screen.group === group);
}

export function findScreen(slug: string): InternalScreen | undefined {
  return INTERNAL_SCREENS.find((screen) => screen.slug === slug);
}

export function internalHref(slug: string): string {
  return `/internal/${slug}`;
}
