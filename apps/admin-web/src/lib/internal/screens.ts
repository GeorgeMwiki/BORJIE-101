/**
 * Borjie Console — Internal admin screen registry (I-W-01 to I-W-20).
 *
 * Single source of truth: dashboard cards, sub-nav groups, breadcrumbs
 * and individual stub pages all derive their copy from this manifest.
 * Mirrors UI_SCREEN_CATALOGUE.md §D — keep the two files in lockstep.
 */

export type ScreenGroup = 'tenants' | 'intelligence' | 'quality' | 'ops';

/**
 * A locale-strict copy pair. The same shape `pickByLocale` consumes — never a
 * concatenated "EN / SW" string. Every user-facing screen label exists in BOTH
 * `en` and `sw` so a Swahili console never shows an English header (zero-mix
 * canon: complete parity, no cross-language fallback).
 */
export interface LocaleVariant {
  readonly en: string;
  readonly sw: string;
}

export interface InternalScreen {
  readonly id: string;
  readonly slug: string;
  /**
   * English title. Retained for the dashboard grid and any non-localized
   * consumer; localized chrome (the ScreenShell header) reads `titleI18n`.
   */
  readonly title: string;
  readonly intent: string;
  /** Locale-strict screen title — both `en` and `sw` for zero-mix headers. */
  readonly titleI18n: LocaleVariant;
  /** Locale-strict screen intent/description — both `en` and `sw`. */
  readonly intentI18n: LocaleVariant;
  readonly group: ScreenGroup;
}

export const INTERNAL_SCREENS: ReadonlyArray<InternalScreen> = [
  {
    id: 'I-W-01',
    slug: 'tenants',
    title: 'Tenant directory',
    intent: 'Sign-up, plan, billing, lifecycle.',
    titleI18n: { en: 'Tenant directory', sw: 'Orodha ya wateja' },
    intentI18n: {
      en: 'Sign-up, plan, billing, lifecycle.',
      sw: 'Usajili, mpango, ankara, mzunguko wa maisha.',
    },
    group: 'tenants',
  },
  {
    id: 'I-W-02',
    slug: 'tenants/detail',
    title: 'Tenant detail',
    intent: 'Live ops view; can impersonate (audited).',
    titleI18n: { en: 'Tenant detail', sw: 'Maelezo ya mteja' },
    intentI18n: {
      en: 'Live ops view; can impersonate (audited).',
      sw: 'Mwonekano wa shughuli hai; unaweza kuiga (kunakaguliwa).',
    },
    group: 'tenants',
  },
  {
    id: 'I-W-03',
    slug: 'corpus',
    title: 'Intelligence corpus management',
    intent:
      'Upload new research / minerals dossiers, supersede entries, version-bump, re-ingest.',
    titleI18n: {
      en: 'Intelligence corpus management',
      sw: 'Usimamizi wa korpasi ya akili',
    },
    intentI18n: {
      en: 'Upload new research / minerals dossiers, supersede entries, version-bump, re-ingest.',
      sw: 'Pakia tafiti / jalada za madini mpya, badilisha maingizo, ongeza toleo, ingiza upya.',
    },
    group: 'intelligence',
  },
  {
    id: 'I-W-04',
    slug: 'citations',
    title: 'Citation library',
    intent: 'Every TZ regulation indexed; gazette ingest pipeline.',
    titleI18n: { en: 'Citation library', sw: 'Maktaba ya marejeo' },
    intentI18n: {
      en: 'Every TZ regulation indexed; gazette ingest pipeline.',
      sw: 'Kila kanuni ya TZ imeorodheshwa; bomba la kuingiza gazeti.',
    },
    group: 'intelligence',
  },
  {
    id: 'I-W-05',
    slug: 'prompts',
    title: 'Prompt registry',
    intent: 'Per-junior system prompts; GEPA scoreboard; promotion log.',
    titleI18n: { en: 'Prompt registry', sw: 'Rejista ya maagizo' },
    intentI18n: {
      en: 'Per-junior system prompts; GEPA scoreboard; promotion log.',
      sw: 'Maagizo ya mfumo kwa kila msaidizi; ubao wa alama wa GEPA; kumbukumbu ya upandishaji.',
    },
    group: 'intelligence',
  },
  {
    id: 'I-W-06',
    slug: 'models',
    title: 'Model registry',
    intent:
      'Which Anthropic / Cohere / Whisper model per junior; cost / latency dashboards.',
    titleI18n: { en: 'Model registry', sw: 'Rejista ya modeli' },
    intentI18n: {
      en: 'Which Anthropic / Cohere / Whisper model per junior; cost / latency dashboards.',
      sw: 'Modeli ipi ya Anthropic / Cohere / Whisper kwa kila msaidizi; dashibodi za gharama / ucheleweshaji.',
    },
    group: 'intelligence',
  },
  {
    id: 'I-W-07',
    slug: 'juniors',
    title: 'Junior catalogue',
    intent: 'Provision / suspend / revoke template juniors.',
    titleI18n: { en: 'Junior catalogue', sw: 'Katalogi ya wasaidizi' },
    intentI18n: {
      en: 'Provision / suspend / revoke template juniors.',
      sw: 'Anzisha / simamisha / batilisha wasaidizi wa kiolezo.',
    },
    group: 'intelligence',
  },
  {
    id: 'I-W-08',
    slug: 'ab-tests',
    title: 'A/B test harness',
    intent: 'Run new prompt against golden set + canary tenants.',
    titleI18n: { en: 'A/B test harness', sw: 'Mfumo wa majaribio ya A/B' },
    intentI18n: {
      en: 'Run new prompt against golden set + canary tenants.',
      sw: 'Endesha agizo jipya dhidi ya seti ya dhahabu + wateja wa majaribio.',
    },
    group: 'quality',
  },
  {
    id: 'I-W-09',
    slug: 'decision-log',
    title: 'Decision-log auditor',
    intent: 'Per-tenant recommendation history with evidence chains.',
    titleI18n: { en: 'Decision-log auditor', sw: 'Mkaguzi wa kumbukumbu za maamuzi' },
    intentI18n: {
      en: 'Per-tenant recommendation history with evidence chains.',
      sw: 'Historia ya mapendekezo kwa kila mteja na minyororo ya ushahidi.',
    },
    group: 'quality',
  },
  {
    id: 'I-W-10',
    slug: 'audit-log',
    title: 'Audit-log viewer',
    intent: 'Append-only event log per tenant.',
    titleI18n: { en: 'Audit-log viewer', sw: 'Kionyeshi cha kumbukumbu za ukaguzi' },
    intentI18n: {
      en: 'Append-only event log per tenant.',
      sw: 'Kumbukumbu ya matukio ya kuongeza-tu kwa kila mteja.',
    },
    group: 'quality',
  },
  {
    id: 'I-W-11',
    slug: 'slo',
    title: 'SLO dashboard',
    intent: 'Latency, error, model-spend per tenant per junior.',
    titleI18n: { en: 'SLO dashboard', sw: 'Dashibodi ya SLO' },
    intentI18n: {
      en: 'Latency, error, model-spend per tenant per junior.',
      sw: 'Ucheleweshaji, makosa, matumizi ya modeli kwa kila mteja kwa kila msaidizi.',
    },
    group: 'quality',
  },
  {
    id: 'I-W-12',
    slug: 'flags',
    title: 'Feature-flag controls',
    intent: 'Per-tenant roll-out.',
    titleI18n: { en: 'Feature-flag controls', sw: 'Vidhibiti vya bendera za vipengele' },
    intentI18n: {
      en: 'Per-tenant roll-out.',
      sw: 'Uzinduzi kwa kila mteja.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-13',
    slug: 'regulator-pipeline',
    title: 'Regulator-change pipeline',
    intent: 'New Gazette / NEMC / BoT → review queue → corpus push.',
    titleI18n: { en: 'Regulator-change pipeline', sw: 'Bomba la mabadiliko ya mdhibiti' },
    intentI18n: {
      en: 'New Gazette / NEMC / BoT → review queue → corpus push.',
      sw: 'Gazeti / NEMC / BoT mpya → foleni ya ukaguzi → kusukuma korpasi.',
    },
    group: 'intelligence',
  },
  {
    id: 'I-W-14',
    slug: 'marketplace',
    title: 'Marketplace moderation',
    intent: 'Listings, ratings, disputes.',
    titleI18n: { en: 'Marketplace moderation', sw: 'Usimamizi wa soko' },
    intentI18n: {
      en: 'Listings, ratings, disputes.',
      sw: 'Matangazo, ukadiriaji, migogoro.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-15',
    slug: 'compliance-queue',
    title: 'Compliance review queue',
    intent: 'Manual-approval gates the Compliance Agent escalates.',
    titleI18n: { en: 'Compliance review queue', sw: 'Foleni ya ukaguzi wa uzingatiaji' },
    intentI18n: {
      en: 'Manual-approval gates the Compliance Agent escalates.',
      sw: 'Vizuizi vya idhini ya mkono ambavyo Wakala wa Uzingatiaji hupandisha.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-16',
    slug: 'support',
    title: 'Support tickets & escalations',
    intent: 'Per-tenant CSAT, ticket SLA.',
    titleI18n: { en: 'Support tickets & escalations', sw: 'Tikiti za msaada na upandishaji' },
    intentI18n: {
      en: 'Per-tenant CSAT, ticket SLA.',
      sw: 'CSAT kwa kila mteja, SLA ya tikiti.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-17',
    slug: 'audit-pack',
    title: 'Regulator audit-pack issuer',
    intent: 'Mint expiring signed URLs.',
    titleI18n: { en: 'Regulator audit-pack issuer', sw: 'Mtoaji wa pakiti za ukaguzi za mdhibiti' },
    intentI18n: {
      en: 'Mint expiring signed URLs.',
      sw: 'Tengeneza anwani zilizotiwa saini zinazoisha muda.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-18',
    slug: 'analytics',
    title: 'Onboarding / churn analytics',
    intent: 'Funnel + cohort.',
    titleI18n: { en: 'Onboarding / churn analytics', sw: 'Takwimu za kuanzisha / kuondoka' },
    intentI18n: {
      en: 'Funnel + cohort.',
      sw: 'Funeli + kundi.',
    },
    group: 'tenants',
  },
  {
    id: 'I-W-19',
    slug: 'rollback',
    title: 'Roll-back panel',
    intent: 'One-click revert of any promoted prompt / model / corpus version.',
    titleI18n: { en: 'Roll-back panel', sw: 'Paneli ya kurudisha nyuma' },
    intentI18n: {
      en: 'One-click revert of any promoted prompt / model / corpus version.',
      sw: 'Rudisha kwa mbofyo mmoja toleo lolote la agizo / modeli / korpasi lililopandishwa.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-20',
    slug: 'killswitch',
    title: 'Killswitch controls',
    intent: 'Env vars HALT / DEGRADED per junior, per tenant.',
    titleI18n: { en: 'Killswitch controls', sw: 'Vidhibiti vya swichi ya kuzima' },
    intentI18n: {
      en: 'Env vars HALT / DEGRADED per junior, per tenant.',
      sw: 'Vigeu vya mazingira SIMAMA / IMEPUNGUZWA kwa kila msaidizi, kwa kila mteja.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-21',
    slug: 'control-plane',
    title: 'Brain control plane',
    intent:
      'Capability powers, LLM routing (core + fallbacks + ensemble + per-use-case), model catalog, and the suggest-only recommender.',
    titleI18n: { en: 'Brain control plane', sw: 'Paneli ya udhibiti wa ubongo' },
    intentI18n: {
      en: 'Capability powers, LLM routing (core + fallbacks + ensemble + per-use-case), model catalog, and the suggest-only recommender.',
      sw: 'Uwezo wa vipaji, uelekezaji wa LLM (msingi + mbadala + mkusanyiko + kwa kila matumizi), katalogi ya modeli, na mpendekezaji wa kupendekeza-tu.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-22',
    slug: 'proposals',
    title: 'Proposals approval queue',
    intent:
      'Human-in-the-loop queue for brain↔tab module-update proposals: review pending_hitl rows and approve / decline (four-eye + approver-tier enforced upstream).',
    titleI18n: { en: 'Proposals approval queue', sw: 'Foleni ya idhini ya mapendekezo' },
    intentI18n: {
      en: 'Human-in-the-loop queue for brain↔tab module-update proposals: review pending_hitl rows and approve / decline (four-eye + approver-tier enforced upstream).',
      sw: 'Foleni ya mtu-katika-mzunguko kwa mapendekezo ya kusasisha moduli ya ubongo↔kichupo: kagua safu za pending_hitl na idhinisha / kataa (macho-manne + ngazi ya mwidhinishaji vinasimamiwa juu).',
    },
    group: 'quality',
  },
  {
    id: 'I-W-23',
    slug: 'junior-ai-factory',
    title: 'Junior-AI factory',
    intent:
      'Provisioned tenant-scoped junior AIs: review each junior’s domain / mandate / lifecycle and suspend or revoke (team-lead gate enforced upstream).',
    titleI18n: { en: 'Junior-AI factory', sw: 'Kiwanda cha AI wasaidizi' },
    intentI18n: {
      en: 'Provisioned tenant-scoped junior AIs: review each junior’s domain / mandate / lifecycle and suspend or revoke (team-lead gate enforced upstream).',
      sw: 'AI wasaidizi walioanzishwa kwa wigo wa mteja: kagua eneo / mamlaka / mzunguko wa maisha wa kila msaidizi na simamisha au batilisha (kizuizi cha kiongozi wa timu kinasimamiwa juu).',
    },
    group: 'intelligence',
  },
  {
    id: 'I-W-24',
    slug: 'task-agents',
    title: 'Task-agents registry',
    intent:
      'Uniform registry of narrow-scope task agents with guardrails; manual-trigger a run (validated against each agent’s schema) and review recent runs.',
    titleI18n: { en: 'Task-agents registry', sw: 'Rejista ya mawakala wa kazi' },
    intentI18n: {
      en: 'Uniform registry of narrow-scope task agents with guardrails; manual-trigger a run (validated against each agent’s schema) and review recent runs.',
      sw: 'Rejista sare ya mawakala wa kazi wa wigo finyu wenye vizuizi; anzisha mwendo kwa mkono (ukithibitishwa dhidi ya skima ya kila wakala) na kagua miendo ya hivi karibuni.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-25',
    slug: 'persona-registry',
    title: 'Persona registry',
    intent:
      'SUPER_ADMIN view of every brain persona (platform + tenant): opening statement, tone, taboos; refresh from DB and remove personas.',
    titleI18n: { en: 'Persona registry', sw: 'Rejista ya wahusika' },
    intentI18n: {
      en: 'SUPER_ADMIN view of every brain persona (platform + tenant): opening statement, tone, taboos; refresh from DB and remove personas.',
      sw: 'Mwonekano wa SUPER_ADMIN wa kila mhusika wa ubongo (jukwaa + mteja): kauli ya ufunguzi, toni, miiko; onyesha upya kutoka DB na ondoa wahusika.',
    },
    group: 'intelligence',
  },
  {
    id: 'I-W-26',
    slug: 'workflow-engine',
    title: 'Workflow engine & flow autonomy',
    intent:
      'Read-first view of the persistent four-eyes workflow engine: your open runs plus each flow’s auto|gated posture and the pending auto-vs-gated confirmation queue.',
    titleI18n: { en: 'Workflow engine & flow autonomy', sw: 'Injini ya mtiririko na uhuru wa mtiririko' },
    intentI18n: {
      en: 'Read-first view of the persistent four-eyes workflow engine: your open runs plus each flow’s auto|gated posture and the pending auto-vs-gated confirmation queue.',
      sw: 'Mwonekano wa kusoma-kwanza wa injini ya mtiririko ya macho-manne inayodumu: miendo yako iliyo wazi pamoja na msimamo wa otomatiki|wenye kizuizi wa kila mtiririko na foleni ya uthibitisho ya otomatiki-dhidi-ya-kizuizi inayosubiri.',
    },
    group: 'ops',
  },
  {
    id: 'I-W-27',
    slug: 'self-healing',
    title: 'Self-healing console',
    intent:
      'Triage every UI/wiring blocker the MAPE-K loop reported — needs-approval code-gated repairs plus auto-healed observations (crystallization candidates), each with insight + action plan. Approve a fix or accept the degrade. Platform-internal; owners never see it.',
    titleI18n: { en: 'Self-healing console', sw: 'Konsoli ya kujiponya' },
    intentI18n: {
      en: 'Triage every UI/wiring blocker the MAPE-K loop reported — needs-approval code-gated repairs plus auto-healed observations (crystallization candidates), each with insight + action plan. Approve a fix or accept the degrade. Platform-internal; owners never see it.',
      sw: 'Panga kila kizuizi cha UI/uunganishaji ambacho mzunguko wa MAPE-K uliripoti — marekebisho yanayohitaji idhini yaliyozuiliwa na msimbo pamoja na uchunguzi ulioponywa otomatiki (wagombea wa fuwele), kila kimoja na ufahamu + mpango wa hatua. Idhinisha marekebisho au kubali upunguzaji. Wa ndani ya jukwaa; wamiliki hawakioni kamwe.',
    },
    group: 'ops',
  },
];

export interface ScreenGroupDescriptor {
  readonly id: ScreenGroup;
  /** English raw label (legacy/non-localized consumers). */
  readonly label: string;
  /** English raw blurb (legacy/non-localized consumers). */
  readonly blurb: string;
  /** Locale-strict label — localized chrome (the console grid) reads this. */
  readonly labelI18n: LocaleVariant;
  /** Locale-strict blurb — localized chrome reads this. */
  readonly blurbI18n: LocaleVariant;
}

export const SCREEN_GROUPS: ReadonlyArray<ScreenGroupDescriptor> = [
  {
    id: 'tenants',
    label: 'Tenants',
    blurb: 'Directory, live ops, lifecycle analytics.',
    labelI18n: { en: 'Tenants', sw: 'Wateja' },
    blurbI18n: {
      en: 'Directory, live ops, lifecycle analytics.',
      sw: 'Orodha, uendeshaji wa moja kwa moja, uchanganuzi wa mzunguko wa maisha.',
    },
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    blurb: 'Corpus, citations, prompts, models, juniors, regulator pipeline.',
    labelI18n: { en: 'Intelligence', sw: 'Akili' },
    blurbI18n: {
      en: 'Corpus, citations, prompts, models, juniors, regulator pipeline.',
      sw: 'Korpasi, marejeo, prompt, modeli, wasaidizi, mfumo wa wadhibiti.',
    },
  },
  {
    id: 'quality',
    label: 'Quality',
    blurb: 'A/B, decision logs, audit logs, SLOs.',
    labelI18n: { en: 'Quality', sw: 'Ubora' },
    blurbI18n: {
      en: 'A/B, decision logs, audit logs, SLOs.',
      sw: 'A/B, kumbukumbu za maamuzi, kumbukumbu za ukaguzi, SLO.',
    },
  },
  {
    id: 'ops',
    label: 'Ops',
    blurb:
      'Flags, marketplace, compliance, support, audit packs, rollbacks, killswitch, control plane.',
    labelI18n: { en: 'Ops', sw: 'Uendeshaji' },
    blurbI18n: {
      en: 'Flags, marketplace, compliance, support, audit packs, rollbacks, killswitch, control plane.',
      sw: 'Bendera, soko, uzingatiaji, msaada, vifurushi vya ukaguzi, marejesho, kitufe cha kuzima, jukwaa la udhibiti.',
    },
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
