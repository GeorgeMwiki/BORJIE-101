/**
 * Micro-Learning Engine — 60-second lesson generator for waiting gaps.
 *
 * Estate-management catalogue of tiny lessons that fit in the moments when a
 * form is loading, a report is rendering, or the user is between tasks.
 *
 * Pure library. Selector is deterministic per (userId, context) to avoid
 * jittery repeated suggestions.
 */

export interface MicroLesson {
  readonly id: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly bodyEn: string;
  readonly bodySw: string;
  readonly durationSeconds: number;
  readonly conceptId: string;
  readonly tags: readonly string[];
}

export const ESTATE_MICRO_LESSONS: readonly MicroLesson[] = [
  {
    id: 'ml-deposit-refund',
    titleEn: 'Performance deposit refunds in 45 seconds',
    titleSw: 'Kurejesha amana ya utendaji kwa sekunde 45',
    bodyEn:
      'Kenya practice: return within 30 days minus documented shortfall. Tanzania typical practice: 14 days. Itemize or owe the full amount.',
    bodySw:
      'Utaratibu wa Kenya: rejesha ndani ya siku 30 ukitoa upungufu. Tanzania: siku 14. Orodhesha au rejesha yote.',
    durationSeconds: 45,
    conceptId: 'deposit_structures',
    tags: ['deposit', 'compliance'],
  },
  {
    id: 'ml-royalty-affordability',
    titleEn: 'The 30% rule and why it matters',
    titleSw: 'Kanuni ya 30% na sababu yake',
    bodyEn:
      'If royalty commitments exceed 30% of gross revenue, default risk climbs sharply. Use the payment-to-revenue ratio as a first vetting screen.',
    bodySw:
      'Ikiwa mrabaha unazidi 30% ya mapato, hatari ya kushindwa kulipa huongezeka. Tumia uwiano huu kama kigezo cha kwanza.',
    durationSeconds: 40,
    conceptId: 'rent_affordability',
    tags: ['vetting', 'risk'],
  },
  {
    id: 'ml-gepg-reconciliation',
    titleEn: 'GePG reconciliation in 3 steps',
    titleSw: 'Ulinganishaji wa GePG kwa hatua 3',
    bodyEn:
      '1) Match receipt number to ledger. 2) If no match, search by amount and date. 3) Still no match? Flag unapplied.',
    bodySw:
      '1) Linganisha risiti na daftari. 2) Ikishindikana, tafuta kwa kiasi na tarehe. 3) Bado hapana? Weka alama.',
    durationSeconds: 50,
    conceptId: 'gepg_reconciliation',
    tags: ['payments', 'finance'],
  },
  {
    id: 'ml-far-inspection',
    titleEn: 'FAR inspection essentials',
    titleSw: 'Msingi wa ukaguzi wa FAR',
    bodyEn:
      'Structural, mechanical, electrical, pumping. Snap a photo per zone. Borjie attaches them to the inspection record.',
    bodySw:
      'Muundo, mitambo, umeme, mabomba. Piga picha kila eneo. Borjie inaziunganisha na rekodi.',
    durationSeconds: 55,
    conceptId: 'rent_affordability',
    tags: ['inspection', 'compliance'],
  },
  {
    id: 'ml-tender-basics',
    titleEn: 'Why we use tenders',
    titleSw: 'Kwa nini tunatumia zabuni',
    bodyEn:
      'Three quotes beat a single vendor pick every time. Borjie scores bids on price, track record, and vendor tier.',
    bodySw:
      'Zabuni tatu ni bora kuliko chaguo moja. Borjie inapima kwa bei, rekodi, na kiwango.',
    durationSeconds: 35,
    conceptId: 'gepg_reconciliation',
    tags: ['tenders', 'procurement'],
  },
  {
    id: 'ml-arrears-ladder',
    titleEn: 'The arrears ladder',
    titleSw: 'Ngazi ya deni',
    bodyEn:
      'Reminder on day 1, warning on day 7, final notice day 14, legal day 30. Each rung is logged for audit.',
    bodySw:
      'Ukumbusho siku 1, onyo siku 7, tahadhari 14, sheria 30. Kila hatua inarekodiwa.',
    durationSeconds: 40,
    conceptId: 'rent_affordability',
    tags: ['arrears', 'collections'],
  },
  {
    id: 'ml-price-escalation',
    titleEn: 'Three escalation clauses',
    titleSw: 'Vifungu vitatu vya kupanda kwa bei',
    bodyEn:
      'CPI-indexed (fairest to buyers), fixed percent (simplest), negotiated (risky — renewal is uncertain).',
    bodySw:
      'Kulingana na mfumuko (haki kwa wanunuzi), asilimia fasili (rahisi), mazungumzo (hatari).',
    durationSeconds: 45,
    conceptId: 'rent_escalation',
    tags: ['offtakes', 'pricing'],
  },
  {
    id: 'ml-vendor-tiers',
    titleEn: 'Vendor tiers explained',
    titleSw: 'Maelezo ya viwango vya wauzaji',
    bodyEn:
      'Bronze: new, unscored. Silver: 5+ clean jobs. Gold: 20+ clean jobs. Platinum: preferred, top 5% performance.',
    bodySw:
      'Shaba: mpya. Fedha: kazi 5+. Dhahabu: 20+. Platinamu: bora zaidi 5%.',
    durationSeconds: 35,
    conceptId: 'gepg_reconciliation',
    tags: ['vendors'],
  },
];

export type MicroLessonContext = 'form-loading' | 'report-rendering' | 'idle-gap' | 'post-task';

export interface MicroLessonSelector {
  pick(input: {
    readonly userId: string;
    readonly tenantId: string;
    readonly context: MicroLessonContext;
    readonly availableSeconds: number;
    readonly recentlyShownIds: readonly string[];
    readonly preferredTags?: readonly string[];
  }): MicroLesson | null;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function createMicroLessonSelector(
  catalog: readonly MicroLesson[] = ESTATE_MICRO_LESSONS,
): MicroLessonSelector {
  return {
    pick(input) {
      const candidates = catalog.filter((lesson) => {
        if (lesson.durationSeconds > input.availableSeconds) return false;
        if (input.recentlyShownIds.includes(lesson.id)) return false;
        if (input.preferredTags && input.preferredTags.length > 0) {
          const anyMatch = lesson.tags.some((t) =>
            input.preferredTags!.includes(t),
          );
          if (!anyMatch) return false;
        }
        return true;
      });
      if (candidates.length === 0) return null;
      const seed = hashString(input.userId + input.tenantId + input.context);
      return candidates[seed % candidates.length] ?? null;
    },
  };
}
