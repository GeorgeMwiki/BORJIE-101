/**
 * Blog Post Generator — Mr. Mwikila generates SEO-optimized estate-management
 * blog posts on demand. Topic templates are curated; the generator fills in
 * the slug / title / excerpt / body on a deterministic structure so editors
 * can quickly review and publish.
 */

import type {
  BlogPost,
  BlogPostDraft,
  GenerateRequest,
  BlogLanguage,
} from './blog-post-types.js';

export interface BlogTopic {
  readonly key: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly tags: readonly string[];
  readonly outlineEn: readonly string[];
  readonly outlineSw: readonly string[];
}

export const BLOG_TOPICS: readonly BlogTopic[] = [
  {
    key: 'tenant-default-signs',
    titleEn: '5 signs your tenant is about to default',
    titleSw: 'Dalili 5 kwamba mpangaji ako karibu kushindwa kulipa',
    tags: ['arrears', 'tenant-management', 'risk'],
    outlineEn: [
      'Late payments by small amounts, then by full amounts',
      'Excuses that shift from "this month" to "next week" to "soon"',
      'Job change or business trouble mentioned in passing',
      'Missing unit inspections or not answering calls',
      'Utility arrears stacking up alongside rent',
    ],
    outlineSw: [
      'Malipo ya chelewa ya kiasi kidogo kisha ya kiasi kamili',
      'Visingizio vinavyobadilika kutoka "mwezi huu" hadi "wiki ijayo"',
      'Taarifa ya mabadiliko ya kazi au biashara kwa bahati',
      'Kupuuza ukaguzi wa vyumba au kutojibu simu',
      'Deni la huduma za umma linaongezeka pamoja na kodi',
    ],
  },
  {
    key: 'rent-affordability',
    titleEn: 'Rent affordability: how much is too much?',
    titleSw: 'Uwezo wa kulipa kodi: kiasi gani ni kingi mno?',
    tags: ['rent-pricing', 'vetting', 'affordability'],
    outlineEn: [
      'The 30% rule and where it comes from',
      'Gross vs net income screens',
      'Savings buffers to hedge seasonality',
      'Hidden costs: utilities, service charges, commute',
      'When a co-guarantor actually reduces risk',
    ],
    outlineSw: [
      'Kanuni ya 30% na chanzo chake',
      'Mapato ghafi dhidi ya mapato halisi',
      'Akiba kwa ajili ya msimu mgumu',
      'Gharama fiche: huduma, usafiri',
      'Mdhamini wa kati anapopunguza hatari kweli',
    ],
  },
  {
    key: 'swahili-owner-guide',
    titleEn: 'Swahili-speaking property owner guide',
    titleSw: 'Mwongozo wa mmiliki wa nyumba anayezungumza Kiswahili',
    tags: ['owner-guide', 'swahili', 'getting-started'],
    outlineEn: [
      'Setting up your owner portal account',
      'Terms every owner must know: lease, rent roll, FAR, arrears',
      'How BORJIE talks to you: Swahili-first, English on demand',
      'Reports you can generate yourself',
      'When to call the estate officer vs. when to resolve solo',
    ],
    outlineSw: [
      'Kuanzisha akaunti yako ya mmiliki',
      'Maneno muhimu kwa kila mmiliki',
      'Jinsi BORJIE inavyozungumza nawe kwa Kiswahili kwanza',
      'Ripoti unazoweza kutengeneza mwenyewe',
      'Lini umuite afisa wa mali, lini ujishughulikie',
    ],
  },
  {
    key: 'far-inspections',
    titleEn: 'FAR inspections explained',
    titleSw: 'Maelezo ya ukaguzi wa FAR',
    tags: ['inspections', 'compliance', 'operations'],
    outlineEn: [
      'What Fitness-for-Acceptable-Residence means',
      'The 4 zones every inspection touches',
      'Photo evidence and auto-attachment to records',
      'How failed inspections escalate',
      'Turning inspection data into preventive maintenance',
    ],
    outlineSw: [
      'Maana ya Fitness-for-Acceptable-Residence',
      'Sehemu 4 za ukaguzi',
      'Picha na ushahidi',
      'Ukaguzi uliofeli unaelekea wapi',
      'Ukaguzi kama chanzo cha matengenezo ya awali',
    ],
  },
  {
    key: 'tender-workflows',
    titleEn: 'Tender workflows for estate maintenance',
    titleSw: 'Mfumo wa zabuni kwa matengenezo',
    tags: ['tenders', 'procurement', 'maintenance'],
    outlineEn: [
      'Why three quotes beat one vendor',
      'Vendor tiers and what they mean',
      'Scoring bids on price, track record, and availability',
      'Awarding and onboarding winners',
      'Audit trail for every award',
    ],
    outlineSw: [
      'Kwa nini zabuni tatu ni bora kuliko moja',
      'Viwango vya wauzaji',
      'Kupima kwa bei, rekodi, na upatikanaji',
      'Kutoa na kuanzisha washindi',
      'Historia ya ukaguzi kwa kila zabuni',
    ],
  },
];

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildBody(topic: BlogTopic, lang: BlogLanguage): string {
  const outline = lang === 'sw' ? topic.outlineSw : topic.outlineEn;
  const title = lang === 'sw' ? topic.titleSw : topic.titleEn;
  const intro =
    lang === 'sw'
      ? 'Huu ni mwongozo wa Mr. Mwikila kuhusu jambo hili muhimu la usimamizi wa mali.'
      : 'This is Mr. Mwikila\'s guide on this important estate-management topic.';
  const sections = outline
    .map((point, i) => {
      const heading = lang === 'sw' ? `## Sehemu ya ${i + 1}. ${point}` : `## Section ${i + 1}. ${point}`;
      const para = lang === 'sw'
        ? 'Hapa ndipo mwongozo unapofafanuliwa kwa mifano halisi ya miradi ya BORJIE.'
        : 'Here we unpack the concept with real examples drawn from BORJIE operations.';
      return `${heading}\n\n${para}`;
    })
    .join('\n\n');
  const outro =
    lang === 'sw'
      ? '## Hitimisho\n\nTumia BORJIE na Mr. Mwikila kusimamia mali yako kwa urahisi.'
      : '## Conclusion\n\nUse BORJIE and Mr. Mwikila to run your estate without the headaches.';
  return `# ${title}\n\n${intro}\n\n${sections}\n\n${outro}`;
}

function buildExcerpt(topic: BlogTopic, lang: BlogLanguage): string {
  const outline = lang === 'sw' ? topic.outlineSw : topic.outlineEn;
  const first = outline[0] ?? '';
  return lang === 'sw'
    ? `Makala ya Mr. Mwikila inayoeleza ${first.toLowerCase()}.`
    : `Mr. Mwikila explains ${first.toLowerCase()} and four more signals every estate operator must watch.`;
}

export function generateBlogPost(request: GenerateRequest): BlogPostDraft {
  const topic = BLOG_TOPICS.find((t) => t.key === request.topicKey);
  if (!topic) {
    throw new Error(`Unknown blog topic: ${request.topicKey}`);
  }
  const title = request.lang === 'sw' ? topic.titleSw : topic.titleEn;
  const slug = slugify(title);
  const bodyMd = buildBody(topic, request.lang);
  const excerpt = buildExcerpt(topic, request.lang);
  const tags = [...topic.tags, ...(request.tags ?? [])];
  return {
    slug,
    title,
    excerpt,
    bodyMd,
    lang: request.lang,
    tags,
  };
}

export function draftToPost(
  draft: BlogPostDraft,
  id: string,
  tenantId: string | null,
  now: string,
  generatedBy = 'mr-mwikila',
): BlogPost {
  return {
    id,
    tenantId,
    slug: draft.slug,
    title: draft.title,
    excerpt: draft.excerpt,
    bodyMd: draft.bodyMd,
    lang: draft.lang,
    tags: draft.tags,
    publishedAt: null,
    generatedBy,
    editedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}
