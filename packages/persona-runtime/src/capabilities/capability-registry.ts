/**
 * CSA-1 — Canonical capability registry (PUBLIC vs INTERNAL).
 *
 * 50+ outcome-only capabilities Mr. Mwikila can disclose to the owner
 * WITHOUT leaking IP. Every entry obeys the disclosure rules in
 * `Docs/AUDIT/CAPABILITY_DISCLOSURE_PATTERNS.md` and the system-prompt
 * extension in `routes/public-chat.hono.ts` / `routes/brain-teach.hono.ts`.
 *
 * Hard rules:
 *   1. user_outcome is what the OWNER gets, never what the system does.
 *   2. public_description NEVER names a service, package, agent count,
 *      table, prompt template, file path, or downstream provider.
 *   3. example_response_pattern is a SHAPE — Mr. Mwikila must adapt to
 *      the live conversation, not recite verbatim.
 *   4. related[] strings are foreign keys back into this registry —
 *      `requireCapability` enforces referential integrity at boot.
 *
 * The registry is a frozen module constant — no module-level mutation.
 */

import type { CapabilityEntry } from './types';
import {
  CapabilityEntrySchema,
  isDisclosable,
  type CapabilityTopic,
  type CapabilityVisibility,
} from './types';

const ENTRIES: ReadonlyArray<CapabilityEntry> = [
  // ─────────────────────────────────────────────────────────────────
  // DRAFTING (10) — owner asks Mr. Mwikila to PRODUCE a document.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.draft.contract',
    topic: 'drafting',
    user_outcome: 'Owner receives a contract draft within a chat turn.',
    public_name: {
      en: 'Draft contracts via chat',
      sw: 'Tengeneza mikataba kwa kuzungumza',
    },
    public_description: {
      en: 'Ask Mr. Mwikila to draft an LOI, off-take agreement, or service contract. Review fields, edit inline, lock and send when ready.',
      sw: 'Mwombe Mwikila aandae LOI, mkataba wa mauzo, au mkataba wa huduma. Hakiki nyanja, hariri papo hapo, funga na tuma ukimaliza.',
    },
    example_question: {
      en: 'Can you write contracts?',
      sw: 'Unaweza kuandika mikataba?',
    },
    example_response_pattern: {
      en: 'Yes. Tell me the kind of contract and the key terms. For example, "draft an LOI for ABC Off-takers, 2 tonnes gold concentrate at TZS 95/gram, delivery in 30 days." I will produce the draft, you review the fields, then we lock and send.',
      sw: 'Ndio. Niambie aina ya mkataba na masharti makuu. Kwa mfano, "andaa LOI kwa ABC Off-takers, tani 2 za madini ya dhahabu kwa TZS 95/gramu, kupelekwa ndani ya siku 30." Nitaandaa rasimu, wewe hakiki nyanja, kisha tunafunga na kutuma.',
    },
    related: ['mwikila.draft.loi', 'mwikila.draft.rfp', 'mwikila.draft.lock'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.loi',
    topic: 'drafting',
    user_outcome: 'Owner receives a Letter of Intent ready to share.',
    public_name: {
      en: 'Draft a Letter of Intent',
      sw: 'Andaa Barua ya Nia',
    },
    public_description: {
      en: 'Mr. Mwikila composes a Letter of Intent in the standard buyer + counterparty format with the deal terms you describe.',
      sw: 'Mwikila huandika Barua ya Nia katika muundo wa kawaida wa mnunuzi na masharti uliyoyaeleza.',
    },
    example_question: {
      en: 'Write me an LOI for the gold buyer',
      sw: 'Niandalie LOI kwa mnunuzi wa dhahabu',
    },
    example_response_pattern: {
      en: 'Happy to. Buyer name, parcel size, price, and delivery date — give me those four and I will produce a draft you can review.',
      sw: 'Sawa kabisa. Jina la mnunuzi, kiasi cha shehena, bei, na tarehe ya kupeleka — nipe hayo manne na nitaandaa rasimu utakayoweza kuhakiki.',
    },
    related: ['mwikila.draft.contract', 'mwikila.draft.share-link'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.rfp',
    topic: 'drafting',
    user_outcome: 'Owner receives an RFP that vendors can respond to.',
    public_name: {
      en: 'Draft a Request for Proposal',
      sw: 'Andaa Ombi la Mapendekezo',
    },
    public_description: {
      en: 'Mr. Mwikila drafts an RFP — scope, evaluation criteria, deadlines — so you can invite multiple vendors and compare offers side-by-side.',
      sw: 'Mwikila huandaa RFP — mawanda, vigezo vya tathmini, tarehe ya mwisho — ili uweze kualika wauzaji wengi na kulinganisha matoleo.',
    },
    example_question: {
      en: 'I need an RFP for haulage to Dar es Salaam',
      sw: 'Nahitaji RFP kwa usafiri hadi Dar es Salaam',
    },
    example_response_pattern: {
      en: 'Got it. Tonnage, route, frequency, and your evaluation criteria (price-only, or weighted with safety / capacity / reliability)? I will produce the RFP and an invite list.',
      sw: 'Vizuri. Tani, njia, mara ngapi, na vigezo vyako vya tathmini (bei pekee, au mchanganyiko wa usalama / uwezo / uaminifu)? Nitaandaa RFP na orodha ya kualika.',
    },
    related: ['mwikila.draft.contract', 'mwikila.marketplace.rfb'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.report',
    topic: 'drafting',
    user_outcome: 'Owner receives a written report ready for board / regulator.',
    public_name: {
      en: 'Draft monthly / quarterly reports',
      sw: 'Andaa ripoti za mwezi au robo mwaka',
    },
    public_description: {
      en: 'Mr. Mwikila compiles a board-ready or regulator-ready report from your operating data — production, royalty, workforce, safety, treasury.',
      sw: 'Mwikila hukusanya ripoti kamili kutoka takwimu zako za uendeshaji — uzalishaji, mrabaha, wafanyakazi, usalama, fedha.',
    },
    example_question: {
      en: 'Give me April board report',
      sw: 'Nipe ripoti ya bodi ya Aprili',
    },
    example_response_pattern: {
      en: 'Pulling April now. I will give you a one-page executive summary and a deeper appendix you can hand to the board. Want the export PDF or do you want to edit in the chat first?',
      sw: 'Ninakusanya ya Aprili sasa. Nitakupa muhtasari wa ukurasa mmoja na kiambatisho cha kina utakachoweza kupeleka bodini. Unataka PDF moja kwa moja au unataka kuhariri kwenye gumzo kwanza?',
    },
    related: ['mwikila.draft.contract', 'mwikila.compliance.eiti'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.letter',
    topic: 'drafting',
    user_outcome: 'Owner has a polished letter to send the same hour.',
    public_name: {
      en: 'Draft formal letters',
      sw: 'Andaa barua rasmi',
    },
    public_description: {
      en: 'Letters to the Mining Commission, NEMC, TRA, banks, off-takers, community leaders — Mr. Mwikila produces the draft in the right register and language.',
      sw: 'Barua kwa Tume ya Madini, NEMC, TRA, benki, wanunuzi, viongozi wa jamii — Mwikila huandaa rasimu kwa lugha na muundo unaohitajika.',
    },
    example_question: {
      en: 'Write a letter to TRA asking for a royalty filing extension',
      sw: 'Andika barua kwa TRA kuomba muda zaidi wa kuwasilisha mrabaha',
    },
    example_response_pattern: {
      en: 'Will do. Reason for the extension, the new date you are requesting, and which filing month — that is all I need.',
      sw: 'Sawa. Sababu ya kuomba muda, tarehe mpya unayotaka, na mwezi wa kuwasilisha — hayo tu ndio ninayohitaji.',
    },
    related: ['mwikila.draft.contract', 'mwikila.communicate.regulator'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.payslip',
    topic: 'drafting',
    user_outcome: 'Worker receives a payslip the moment payroll runs.',
    public_name: {
      en: 'Generate payslips',
      sw: 'Tengeneza vipande vya mishahara',
    },
    public_description: {
      en: 'Each payroll cycle Mr. Mwikila produces a bilingual payslip for every worker, showing gross, deductions, net, and the period worked.',
      sw: 'Kila mzunguko wa malipo Mwikila huandaa kipande cha mshahara cha lugha mbili kwa kila mfanyakazi, kionesha jumla, makato, halisi, na kipindi cha kazi.',
    },
    example_question: {
      en: 'Did Juma get his April payslip?',
      sw: 'Je, Juma alipata kipande chake cha mshahara cha Aprili?',
    },
    example_response_pattern: {
      en: 'Yes, Juma\'s April payslip was issued on the 30th. Want me to re-send it to his phone?',
      sw: 'Ndio, kipande cha Juma cha Aprili kilitolewa tarehe 30. Unataka nimtumie tena kwa simu yake?',
    },
    related: ['mwikila.hr.payroll', 'mwikila.communicate.worker'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.share-link',
    topic: 'drafting',
    user_outcome: 'Counterparty receives a shareable, time-limited link.',
    public_name: {
      en: 'Share a draft via secure link',
      sw: 'Shiriki rasimu kwa kiungo salama',
    },
    public_description: {
      en: 'Mr. Mwikila creates a secure link to a draft so a buyer or vendor can review without needing a Borjie login. The link expires automatically.',
      sw: 'Mwikila huunda kiungo salama cha rasimu ili mnunuzi au muuzaji aweze kuhakiki bila kuhitaji akaunti ya Borjie. Kiungo huishia chenyewe.',
    },
    example_question: {
      en: 'Send the LOI to the buyer',
      sw: 'Mtumie mnunuzi LOI',
    },
    example_response_pattern: {
      en: 'I can share it as a 7-day secure link. Confirm the buyer email and I will send it; otherwise I can paste the link here so you forward it yourself.',
      sw: 'Ninaweza kushiriki kama kiungo salama cha siku 7. Thibitisha barua pepe ya mnunuzi nitumie; vinginevyo naweza kuweka kiungo hapa upeleke mwenyewe.',
    },
    related: ['mwikila.draft.contract', 'mwikila.draft.loi'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.lock',
    topic: 'drafting',
    user_outcome: 'Owner locks a revision so it cannot be edited silently.',
    public_name: {
      en: 'Lock a revision before sending',
      sw: 'Funga toleo kabla ya kutuma',
    },
    public_description: {
      en: 'Once you lock a draft revision, it becomes immutable. Any later change creates a new revision so the audit trail stays clean.',
      sw: 'Ukifunga toleo, halitabadilishwa tena. Mabadiliko ya baadaye huunda toleo jipya ili mfuatano wa uhakiki ubaki safi.',
    },
    example_question: {
      en: 'Lock this contract',
      sw: 'Funga mkataba huu',
    },
    example_response_pattern: {
      en: 'Locking creates an immutable revision. If you change your mind later I will copy it into a new revision so nothing is lost. Confirm to lock?',
      sw: 'Kufunga kunaunda toleo lisilobadilika. Ukibadili mawazo baadaye nitanakili kuwa toleo jipya ili kitu kisipotee. Thibitisha kufunga?',
    },
    related: ['mwikila.draft.contract', 'mwikila.decision.record'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.bid-response',
    topic: 'drafting',
    user_outcome: 'Owner produces a winning bid response without copy-paste.',
    public_name: {
      en: 'Respond to an open bid',
      sw: 'Jibu zabuni iliyopo',
    },
    public_description: {
      en: 'Mr. Mwikila drafts your response to an open RFB or tender, pre-filled with your licence, capacity, and price floor.',
      sw: 'Mwikila huandaa jibu lako kwa RFB au zabuni iliyopo, ikiwa imejazwa leseni, uwezo, na bei ya chini.',
    },
    example_question: {
      en: 'Help me bid on the Geita haulage tender',
      sw: 'Nisaidie kuomba zabuni ya usafiri ya Geita',
    },
    example_response_pattern: {
      en: 'I have your last three haulage rates on file. I will use those plus the tender\'s scope. Anything special you want me to lead with — capacity, safety record, or local hire?',
      sw: 'Nina viwango vyako vitatu vya mwisho vya usafiri kwenye faili. Nitatumia hivyo pamoja na mawanda ya zabuni. Kuna kitu maalum unataka nikiweke mbele — uwezo, rekodi ya usalama, au ajira ya ndani?',
    },
    related: ['mwikila.marketplace.bid', 'mwikila.draft.rfp'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.draft.template-library',
    topic: 'drafting',
    user_outcome: 'Owner picks from a vetted set of mining-specific drafts.',
    public_name: {
      en: 'Use vetted mining templates',
      sw: 'Tumia violezo vya madini vilivyothibitishwa',
    },
    public_description: {
      en: 'Common documents — service contracts, off-take agreements, NDAs, employment letters — are available as templates Mr. Mwikila tailors to your estate.',
      sw: 'Hati za kawaida — mikataba ya huduma, mauzo, NDA, ajira — zinapatikana kama violezo Mwikila ataviwekea estate yako.',
    },
    example_question: {
      en: 'What contract templates do you have?',
      sw: 'Una violezo gani vya mikataba?',
    },
    example_response_pattern: {
      en: 'I can start an NDA, employment letter, off-take agreement, haulage contract, security service contract, or community engagement MoU. Which fits today?',
      sw: 'Naweza kuanza NDA, barua ya ajira, mkataba wa mauzo, mkataba wa usafiri, mkataba wa ulinzi, au MoU ya jamii. Ipi inafaa leo?',
    },
    related: ['mwikila.draft.contract', 'mwikila.draft.letter'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // TRACKING (6) — owner monitors live state of entities.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.track.sales',
    topic: 'tracking',
    user_outcome: 'Owner sees every sale by parcel, buyer, and date.',
    public_name: {
      en: 'Track ore sales in real time',
      sw: 'Fuatilia mauzo ya madini kwa wakati halisi',
    },
    public_description: {
      en: 'Every sale recorded — parcel, buyer, weight, grade, price, payment status — kept on the cockpit and searchable months later.',
      sw: 'Kila uuzaji umerekodiwa — shehena, mnunuzi, uzito, daraja, bei, hali ya malipo — huhifadhiwa kwenye dashibodi na kutafutwa miezi baadaye.',
    },
    example_question: {
      en: 'What did we sell last week?',
      sw: 'Tuliuza nini wiki iliyopita?',
    },
    example_response_pattern: {
      en: 'Three parcels last week — 1.8 kg gold doré to ABC, 12 kg gemstone rough to XYZ, 240 kg industrial to local trader. Want the buyer breakdown or the cash settlement view?',
      sw: 'Shehena tatu wiki iliyopita — kg 1.8 ya dhahabu kwa ABC, kg 12 ya vito kwa XYZ, kg 240 ya viwanda kwa mfanyabiashara wa ndani. Unataka mchanganuo wa wanunuzi au mwonekano wa malipo?',
    },
    related: ['mwikila.track.payments', 'mwikila.forecast.cashflow'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.track.royalty',
    topic: 'tracking',
    user_outcome: 'Owner knows exactly what royalty is due before it is due.',
    public_name: {
      en: 'Track royalty owed and filed',
      sw: 'Fuatilia mrabaha unaodaiwa na uliowasilishwa',
    },
    public_description: {
      en: 'Mr. Mwikila keeps a running total of royalty owed by mineral and by month, plus the filing status against the Mining Commission cut-off.',
      sw: 'Mwikila huhifadhi jumla ya mrabaha unaodaiwa kwa madini na kwa mwezi, pamoja na hali ya kuwasilisha kabla ya tarehe ya mwisho ya Tume ya Madini.',
    },
    example_question: {
      en: 'How much royalty for April?',
      sw: 'Mrabaha wa Aprili ni kiasi gani?',
    },
    example_response_pattern: {
      en: 'April royalty is sitting at TZS 18.4M against your gold parcels. The draft is ready; cut-off is in 4 days. Want me to walk you through it before you sign?',
      sw: 'Mrabaha wa Aprili ni TZS 18.4M kutoka shehena zako za dhahabu. Rasimu ipo tayari; tarehe ya mwisho ni siku 4. Unataka nikupitishe kabla ya kusaini?',
    },
    related: ['mwikila.track.sales', 'mwikila.alert.payment'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.track.licences',
    topic: 'tracking',
    user_outcome: 'Owner sees every licence and its days-to-expiry at a glance.',
    public_name: {
      en: 'Track licence calendar',
      sw: 'Fuatilia kalenda ya leseni',
    },
    public_description: {
      en: 'PML, ML, SML — Mr. Mwikila tracks every active licence, the days remaining, and pre-fills the renewal form 47 days before expiry.',
      sw: 'PML, ML, SML — Mwikila hufuatilia kila leseni, siku zilizobaki, na kujaza fomu ya upyaji siku 47 kabla ya muda kuisha.',
    },
    example_question: {
      en: 'Any licences expiring soon?',
      sw: 'Kuna leseni zinazoisha hivi karibuni?',
    },
    example_response_pattern: {
      en: 'Two PMLs hit the 90-day window. Geita has 23 days and is auto-queued; Mererani needs your sign-off in the next 47. Tap to open either.',
      sw: 'PML mbili zinakaribia siku 90. Geita ina siku 23 imesajiliwa moja kwa moja; Mererani inahitaji saini yako ndani ya siku 47. Bonyeza kufungua mojawapo.',
    },
    related: ['mwikila.alert.licence', 'mwikila.compliance.pccb'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.track.sites',
    topic: 'tracking',
    user_outcome: 'Owner has live status per site across the estate.',
    public_name: {
      en: 'Track sites at-a-glance',
      sw: 'Fuatilia tovuti kwa muhtasari',
    },
    public_description: {
      en: 'Every site shows production, workforce on shift, open incidents, and the latest regulator state in one view.',
      sw: 'Kila tovuti huonesha uzalishaji, wafanyakazi kazini, matukio yaliyofunguliwa, na hali ya mwisho ya wadhibiti katika mwonekano mmoja.',
    },
    example_question: {
      en: 'How is Geita doing today?',
      sw: 'Geita inafanyaje leo?',
    },
    example_response_pattern: {
      en: 'Geita: 42 tonnes processed today, 38 workers on shift, zero open incidents. The NEMC review is 12 days out. Want me to open the full Geita view?',
      sw: 'Geita: tani 42 zimechakata leo, wafanyakazi 38 kazini, hakuna matukio. Tathmini ya NEMC ni siku 12. Unataka nifungue mwonekano kamili wa Geita?',
    },
    related: ['mwikila.track.workers', 'mwikila.safety.incident'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.track.workers',
    topic: 'tracking',
    user_outcome: 'Owner sees who is on shift, who is on leave, and certification gaps.',
    public_name: {
      en: 'Track workforce status',
      sw: 'Fuatilia hali ya wafanyakazi',
    },
    public_description: {
      en: 'Live attendance, leave balance, certifications nearing expiry, and overtime exposure per worker.',
      sw: 'Mahudhurio ya wakati halisi, mapumziko yaliyobaki, vyeti vinavyokaribia kuisha, na muda wa ziada kwa kila mfanyakazi.',
    },
    example_question: {
      en: 'Who is on shift right now?',
      sw: 'Ni nani yupo kazini sasa?',
    },
    example_response_pattern: {
      en: '38 workers on shift across all sites — 24 at Geita, 9 at Mererani, 5 at Mwadui. Three have certifications expiring this month. Want the list?',
      sw: 'Wafanyakazi 38 kazini katika tovuti zote — 24 Geita, 9 Mererani, 5 Mwadui. Watatu wana vyeti vinavyoisha mwezi huu. Unataka orodha?',
    },
    related: ['mwikila.alert.certification', 'mwikila.hr.payroll'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.track.payments',
    topic: 'tracking',
    user_outcome: 'Owner sees money in, money out, and balances per account.',
    public_name: {
      en: 'Track payments in and out',
      sw: 'Fuatilia malipo yanayoingia na kutoka',
    },
    public_description: {
      en: 'M-Pesa, bank transfers, USD wires — Mr. Mwikila reconciles each entry to a sale, a supplier, or payroll, so your books stay current.',
      sw: 'M-Pesa, uhamisho wa benki, wire za USD — Mwikila huoanisha kila kiingilio na uuzaji, muuzaji, au malipo, ili vitabu vyako vikae sasa.',
    },
    example_question: {
      en: 'Is the buyer payment in?',
      sw: 'Je, malipo ya mnunuzi yameingia?',
    },
    example_response_pattern: {
      en: 'ABC paid TZS 87M against parcel #P-0418 at 09:14 today. The reconciliation is clean — net of bank fees TZS 86.7M. Anything else you want to check on that parcel?',
      sw: 'ABC walilipa TZS 87M kwa shehena #P-0418 saa 09:14 leo. Uoanishaji ni safi — baada ya ada za benki TZS 86.7M. Kuna kingine cha kuhakiki kwenye shehena hiyo?',
    },
    related: ['mwikila.track.sales', 'mwikila.forecast.cashflow'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // ALERTING (4) — proactive nudges before something goes wrong.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.alert.licence',
    topic: 'alerting',
    user_outcome: 'Owner is reminded BEFORE a licence expires.',
    public_name: {
      en: 'Licence-expiry early warning',
      sw: 'Onyo la mapema la kuisha kwa leseni',
    },
    public_description: {
      en: 'Mr. Mwikila warns you 90, 60, 47, 30, and 7 days before any licence expires, with the renewal form already pre-filled.',
      sw: 'Mwikila hukuonya siku 90, 60, 47, 30, na 7 kabla ya leseni yoyote kuisha, fomu ya upyaji ikiwa tayari imejazwa.',
    },
    example_question: {
      en: 'Will you remind me before licences expire?',
      sw: 'Utanikumbusha kabla leseni hazijaisha?',
    },
    example_response_pattern: {
      en: 'Yes. You will hear from me at 90, 60, 47, 30, and 7 days out — and the renewal draft is ready at the 47-day mark so you only need to review and sign.',
      sw: 'Ndio. Utanisikia siku 90, 60, 47, 30, na 7 — na rasimu ya upyaji huwa tayari siku ya 47 ili upitishe na kusaini tu.',
    },
    related: ['mwikila.track.licences', 'mwikila.alert.payment'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.alert.payment',
    topic: 'alerting',
    user_outcome: 'Owner catches an overdue payment within hours, not weeks.',
    public_name: {
      en: 'Overdue-payment alerts',
      sw: 'Onyo la malipo yaliyochelewa',
    },
    public_description: {
      en: 'Buyers who miss their payment window, suppliers you forgot to pay, or M-Pesa receipts that did not reconcile — Mr. Mwikila flags each one.',
      sw: 'Wanunuzi waliokosa muda wa malipo, wauzaji ulisahau kuwalipa, au risiti za M-Pesa zisizoendana — Mwikila huzionesha zote.',
    },
    example_question: {
      en: 'Any payments overdue?',
      sw: 'Kuna malipo yaliyochelewa?',
    },
    example_response_pattern: {
      en: 'Two. XYZ Buyer is 4 days late on TZS 42M for parcel #P-0411. The haulage vendor invoice from 12 days ago is unpaid — TZS 6.3M. Want to chase one of them now?',
      sw: 'Mawili. XYZ amechelewa siku 4 kwa TZS 42M ya shehena #P-0411. Ankara ya usafiri ya siku 12 zilizopita haijalipwa — TZS 6.3M. Unataka kufuatilia mojawapo sasa?',
    },
    related: ['mwikila.track.payments', 'mwikila.communicate.buyer'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.alert.certification',
    topic: 'alerting',
    user_outcome: 'Owner replaces a worker certificate before it lapses.',
    public_name: {
      en: 'Worker-certification expiry alerts',
      sw: 'Onyo la kuisha kwa vyeti vya wafanyakazi',
    },
    public_description: {
      en: 'Blast safety, ICA equipment, first-aid — Mr. Mwikila tracks every cert and warns 60 / 30 / 7 days before lapse so you stay compliant.',
      sw: 'Usalama wa milipuko, ICA, msaada wa kwanza — Mwikila hufuatilia kila cheti na huonya siku 60 / 30 / 7 kabla ya kuisha ili ubaki na utii.',
    },
    example_question: {
      en: 'Are any worker certifications expiring?',
      sw: 'Kuna vyeti vya wafanyakazi vinavyoisha?',
    },
    example_response_pattern: {
      en: 'Three this month. Juma\'s blast cert expires May 18, two ICA operator licences expire May 24. I have the refresh courses scheduled — want me to confirm the bookings?',
      sw: 'Vitatu mwezi huu. Cheti cha milipuko cha Juma kinaisha Mei 18, leseni mbili za ICA zinaisha Mei 24. Nimepanga kozi za upyaji — unataka nithibitishe?',
    },
    related: ['mwikila.track.workers', 'mwikila.hr.onboard'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.alert.risk',
    topic: 'alerting',
    user_outcome: 'Owner sees an emerging risk before it lands.',
    public_name: {
      en: 'Early risk warnings',
      sw: 'Onyo la mapema la hatari',
    },
    public_description: {
      en: 'Unusual production drops, FX exposure spikes, weather risks against haulage windows, audit flags — Mr. Mwikila surfaces them while you can still act.',
      sw: 'Kushuka kwa uzalishaji, ongezeko la hatari ya fedha za kigeni, hali ya hewa dhidi ya usafiri, alama za ukaguzi — Mwikila huzionesha wakati bado unaweza kufanya kitu.',
    },
    example_question: {
      en: 'Anything I should worry about?',
      sw: 'Kuna kitu cha kuwa na wasiwasi?',
    },
    example_response_pattern: {
      en: 'Two flags worth looking at. Mererani output is 14% below the rolling average for 5 days running, and the USD window swings the next 48 hours could cost you TZS 11M on the unhedged parcel. Want to dig into either?',
      sw: 'Alama mbili za kuangalia. Uzalishaji wa Mererani uko chini ya wastani kwa 14% siku 5 mfululizo, na mtikisiko wa USD masaa 48 yajayo unaweza kukugharimu TZS 11M kwenye shehena isiyofungwa. Unataka kuchunguza mojawapo?',
    },
    related: ['mwikila.forecast.cashflow', 'mwikila.decision.alternatives'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // FORECASTING (3) — owner sees the near future.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.forecast.cashflow',
    topic: 'forecasting',
    user_outcome: 'Owner sees a 30-90 day cash projection.',
    public_name: {
      en: 'Project cash flow 30-90 days',
      sw: 'Tabiri mtiririko wa fedha siku 30-90',
    },
    public_description: {
      en: 'Mr. Mwikila projects cash in (sales, payments due) and cash out (royalty, payroll, vendor) so you know where you will stand at month-end.',
      sw: 'Mwikila hutabiri fedha zinazoingia (mauzo, malipo) na zinazotoka (mrabaha, mishahara, wauzaji) ili ujue utakapokuwa mwisho wa mwezi.',
    },
    example_question: {
      en: 'Will I have enough cash for June payroll?',
      sw: 'Nitakuwa na fedha za kutosha kwa malipo ya Juni?',
    },
    example_response_pattern: {
      en: 'On current pace, yes. June payroll is TZS 84M; the projected June 25 balance after royalty is TZS 112M. The risk is if XYZ slips again — that pulls TZS 42M out of the buffer.',
      sw: 'Kwa mwendo wa sasa, ndio. Mshahara wa Juni ni TZS 84M; baki itakayobaki Juni 25 baada ya mrabaha ni TZS 112M. Hatari ni kama XYZ atachelewa tena — hiyo huondoa TZS 42M kwenye akiba.',
    },
    related: ['mwikila.track.payments', 'mwikila.forecast.royalty'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.forecast.royalty',
    topic: 'forecasting',
    user_outcome: 'Owner knows next month royalty before the month ends.',
    public_name: {
      en: 'Forecast next-month royalty',
      sw: 'Tabiri mrabaha wa mwezi unaofuata',
    },
    public_description: {
      en: 'Based on production rate, mineral mix, and price trend, Mr. Mwikila projects the royalty you will file next month.',
      sw: 'Kutoka kasi ya uzalishaji, mchanganyiko wa madini, na mwenendo wa bei, Mwikila hutabiri mrabaha utakaowasilisha mwezi unaofuata.',
    },
    example_question: {
      en: 'What will May royalty be?',
      sw: 'Mrabaha wa Mei utakuwa kiasi gani?',
    },
    example_response_pattern: {
      en: 'Tracking around TZS 21M, give or take 8% depending on the LBMA fix this Friday. I can hold the projection and update you on Friday close.',
      sw: 'Inakaribia TZS 21M, jia au chini ya 8% kulingana na bei ya LBMA Ijumaa hii. Naweza kushikilia utabiri na kukujulisha Ijumaa.',
    },
    related: ['mwikila.track.royalty', 'mwikila.forecast.cashflow'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.forecast.payroll',
    topic: 'forecasting',
    user_outcome: 'Owner sees payroll cost trends and one-off spikes.',
    public_name: {
      en: 'Forecast payroll cost',
      sw: 'Tabiri gharama ya mishahara',
    },
    public_description: {
      en: 'Mr. Mwikila projects payroll by site and role, including overtime exposure and any contract renewals due.',
      sw: 'Mwikila hutabiri mishahara kwa tovuti na kazi, ikiwa ni pamoja na muda wa ziada na mikataba inayohitaji upyaji.',
    },
    example_question: {
      en: 'What is payroll trending at?',
      sw: 'Mishahara inaelekea kiasi gani?',
    },
    example_response_pattern: {
      en: 'You are running about TZS 82-86M monthly. Overtime at Mererani has crept up TZS 4M over March — want me to break that out?',
      sw: 'Unaendesha kati ya TZS 82-86M kwa mwezi. Muda wa ziada Mererani umeongezeka TZS 4M tangu Machi — unataka nikuchanganue?',
    },
    related: ['mwikila.forecast.cashflow', 'mwikila.hr.payroll'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // COMMUNICATING (4) — owner reaches people from chat.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.communicate.manager',
    topic: 'communicating',
    user_outcome: 'Owner pings a site manager and gets a tracked thread.',
    public_name: {
      en: 'Message a site manager',
      sw: 'Tumia ujumbe kwa msimamizi wa tovuti',
    },
    public_description: {
      en: 'Send a managed message to any site manager from chat — Mr. Mwikila timestamps it, follows up if unread, and surfaces the reply.',
      sw: 'Tuma ujumbe usimamiwa kwa msimamizi yeyote wa tovuti kutoka kwenye gumzo — Mwikila huuwekea muhuri wa muda, hufuatilia, na huleta jibu.',
    },
    example_question: {
      en: 'Ask the Geita manager why output dropped',
      sw: 'Mwulize msimamizi wa Geita kwanini uzalishaji ulishuka',
    },
    example_response_pattern: {
      en: 'Sent. Asked Daudi to confirm the drill-hole status and the compressor uptime. I will alert you the moment he replies — usually within 30 minutes during shift.',
      sw: 'Imetumwa. Nimemwomba Daudi athibitishe hali ya kuchimba na kompresa. Nitakujulisha mara atakapojibu — kwa kawaida ndani ya dakika 30 wakati wa zamu.',
    },
    related: ['mwikila.communicate.worker', 'mwikila.track.sites'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.communicate.worker',
    topic: 'communicating',
    user_outcome: 'Worker receives a clear bilingual instruction.',
    public_name: {
      en: 'Reach individual workers',
      sw: 'Wasiliana na wafanyakazi',
    },
    public_description: {
      en: 'Bilingual messages, payslip notifications, shift changes, safety briefings — sent direct to worker phones via SMS or push.',
      sw: 'Ujumbe wa lugha mbili, taarifa za mishahara, mabadiliko ya zamu, mafunzo ya usalama — hutumwa moja kwa moja kwa simu za wafanyakazi.',
    },
    example_question: {
      en: 'Tell the night shift safety briefing is at 18:00',
      sw: 'Waambie wafanyakazi wa zamu ya usiku mafunzo ya usalama ni saa 12 jioni',
    },
    example_response_pattern: {
      en: 'Drafted in Swahili and English: "Briefing ya usalama leo saa 12 jioni, kambi kuu. Kuhudhuria ni lazima. / Safety briefing today at 18:00, main camp. Attendance mandatory." Send to the 14 workers on the night shift?',
      sw: 'Imeandikwa Kiswahili na Kiingereza: "Briefing ya usalama leo saa 12 jioni, kambi kuu. Kuhudhuria ni lazima. / Safety briefing today at 18:00, main camp. Attendance mandatory." Tume kwa wafanyakazi 14 wa zamu ya usiku?',
    },
    related: ['mwikila.communicate.manager', 'mwikila.safety.incident'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.communicate.buyer',
    topic: 'communicating',
    user_outcome: 'Owner closes a buyer loop without leaving chat.',
    public_name: {
      en: 'Reach a buyer or off-taker',
      sw: 'Wasiliana na mnunuzi au off-taker',
    },
    public_description: {
      en: 'Chase a payment, update a parcel ETA, share a grade certificate — all from chat, tracked in the buyer relationship history.',
      sw: 'Fuatilia malipo, sasisha ETA ya shehena, shiriki cheti cha daraja — yote kutoka kwenye gumzo, vinafuatiliwa kwenye historia ya uhusiano.',
    },
    example_question: {
      en: 'Chase XYZ on their late payment',
      sw: 'Fuatilia XYZ kwa malipo yaliyochelewa',
    },
    example_response_pattern: {
      en: 'Drafted a polite escalation note referencing the May 12 invoice and the original payment date. Want me to add a 10% late-fee clause or just send the reminder first?',
      sw: 'Nimeandika ujumbe wa heshima ukitaja ankara ya Mei 12 na tarehe ya awali ya malipo. Unataka niongeze kipengele cha ada ya 10% au nitume tu kumbukumbu kwanza?',
    },
    related: ['mwikila.alert.payment', 'mwikila.marketplace.rfb'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.communicate.regulator',
    topic: 'communicating',
    user_outcome: 'Regulator gets the right format and the owner stays compliant.',
    public_name: {
      en: 'Correspond with regulators',
      sw: 'Wasiliana na wadhibiti',
    },
    public_description: {
      en: 'Mining Commission, NEMC, TRA, BoT, BRELA — Mr. Mwikila composes the request, attaches the right evidence, and tracks the response window.',
      sw: 'Tume ya Madini, NEMC, TRA, BoT, BRELA — Mwikila huandika ombi, kuambatisha ushahidi, na kufuatilia muda wa jibu.',
    },
    example_question: {
      en: 'I need to ask NEMC for a site visit',
      sw: 'Nahitaji kuomba NEMC ziara ya tovuti',
    },
    example_response_pattern: {
      en: 'Will do. Which site, what date range, and is there a specific concern (compliance check, EIA refresh, complaint follow-up)? I will draft and queue for your sign-off.',
      sw: 'Sawa. Tovuti ipi, wakati gani, na kuna jambo maalum (ukaguzi wa utii, upyaji wa EIA, kufuatilia malalamiko)? Nitaandaa na kuweka tayari kwa saini yako.',
    },
    related: ['mwikila.draft.letter', 'mwikila.compliance.pccb'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // SEARCHING (3) — owner recalls a fact from estate history.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.search.documents',
    topic: 'searching',
    user_outcome: 'Owner finds the right document by description, not file name.',
    public_name: {
      en: 'Find any document by description',
      sw: 'Tafuta hati yoyote kwa maelezo',
    },
    public_description: {
      en: 'Describe the document — "the EIA letter from last September" — and Mr. Mwikila pulls it up with citation.',
      sw: 'Eleza hati — "barua ya EIA ya Septemba mwaka jana" — na Mwikila huitoa pamoja na kumbukumbu.',
    },
    example_question: {
      en: 'Find that contract from 6 months ago',
      sw: 'Tafuta mkataba ule wa miezi 6 iliyopita',
    },
    example_response_pattern: {
      en: 'Two matches from November: the ABC off-take agreement and the haulage service contract with TransCo. Which one are you thinking of?',
      sw: 'Mechi mbili za Novemba: mkataba wa mauzo na ABC na mkataba wa usafiri wa TransCo. Unafikiria upi?',
    },
    related: ['mwikila.search.entities', 'mwikila.memory.recall'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.search.entities',
    topic: 'searching',
    user_outcome: 'Owner navigates the estate via natural language.',
    public_name: {
      en: 'Find any entity by name or trait',
      sw: 'Tafuta kitu chochote kwa jina au sifa',
    },
    public_description: {
      en: 'Find a worker, parcel, buyer, vendor, site, licence — even by a partial trait ("the supplier who delivered diesel last week").',
      sw: 'Tafuta mfanyakazi, shehena, mnunuzi, muuzaji, tovuti, leseni — hata kwa sifa kidogo ("muuzaji aliyepeleka dizeli wiki iliyopita").',
    },
    example_question: {
      en: 'Who is the supplier who delivered diesel last week?',
      sw: 'Ni nani muuzaji aliyepeleka dizeli wiki iliyopita?',
    },
    example_response_pattern: {
      en: 'That is Hassan Petroleum — they delivered 4,200 litres on Monday and 3,800 on Friday. The May invoice is paid; want the running total for the quarter?',
      sw: 'Huyo ni Hassan Petroleum — walipeleka lita 4,200 Jumatatu na 3,800 Ijumaa. Ankara ya Mei imelipwa; unataka jumla ya robo?',
    },
    related: ['mwikila.search.documents', 'mwikila.track.sites'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.search.history',
    topic: 'searching',
    user_outcome: 'Owner replays a past decision or conversation.',
    public_name: {
      en: 'Recall past decisions and chats',
      sw: 'Kumbuka maamuzi na mazungumzo ya zamani',
    },
    public_description: {
      en: 'Search the full history of your decisions, chat threads, and recorded outcomes by topic or by date.',
      sw: 'Tafuta historia kamili ya maamuzi, mazungumzo, na matokeo kwa mada au kwa tarehe.',
    },
    example_question: {
      en: 'What did we decide about the Mererani expansion?',
      sw: 'Tuliamua nini kuhusu upanuzi wa Mererani?',
    },
    example_response_pattern: {
      en: 'Decision logged March 18: hold expansion until Q3, contingent on the gold price holding above USD 2,400. The retrospective grade is still pending — want me to update it now?',
      sw: 'Uamuzi ulirekodiwa Machi 18: kushikilia upanuzi hadi robo ya tatu, kulingana na bei ya dhahabu kubaki juu ya USD 2,400. Tathmini bado iko hewani — unataka tuisasishe sasa?',
    },
    related: ['mwikila.decision.record', 'mwikila.memory.recall'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // COMPLIANCE (4) — owner stays on the right side of every regulator.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.compliance.pccb',
    topic: 'compliance',
    user_outcome: 'Owner files PCCB / anti-corruption disclosures on time.',
    public_name: {
      en: 'PCCB and anti-graft filings',
      sw: 'Mawasilisho ya PCCB na dhidi ya ufisadi',
    },
    public_description: {
      en: 'Disclosure schedules, beneficial-ownership statements, and conflict logs prepared in the format PCCB requires.',
      sw: 'Ratiba za ufichuaji, taarifa za umiliki, na rekodi za migongano zikitayarishwa katika muundo wa PCCB.',
    },
    example_question: {
      en: 'When is the next PCCB filing due?',
      sw: 'Ni lini mawasilisho ya PCCB yajayo yanapaswa?',
    },
    example_response_pattern: {
      en: 'Next disclosure window is June 30. Your prior submission is on file; I can draft this quarter\'s update from the latest ledger. Want to start it now?',
      sw: 'Dirisha lijalo ni Juni 30. Wasilisho la awali liko kwenye faili; naweza kuandaa upyaji wa robo hii kutoka kwenye leja. Tuanze sasa?',
    },
    related: ['mwikila.compliance.nemc', 'mwikila.draft.report'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.compliance.nemc',
    topic: 'compliance',
    user_outcome: 'Owner keeps the environmental file always ready.',
    public_name: {
      en: 'NEMC EIA cycle management',
      sw: 'Usimamizi wa mzunguko wa EIA wa NEMC',
    },
    public_description: {
      en: 'EIA review windows tracked per site, evidence pre-staged, site-visit requests filed in the right format.',
      sw: 'Vipindi vya tathmini ya EIA hufuatiliwa kwa kila tovuti, ushahidi umejiandaa, maombi ya ziara hujazwa katika muundo unaofaa.',
    },
    example_question: {
      en: 'Where am I with NEMC?',
      sw: 'Niko wapi na NEMC?',
    },
    example_response_pattern: {
      en: 'Geita\'s EIA review window opens in 12 days; the evidence pack is 80% ready. Mererani is good through October. Want to close the Geita gap now?',
      sw: 'Dirisha la tathmini ya EIA la Geita linafunguka siku 12; ushahidi uko tayari 80%. Mererani iko salama hadi Oktoba. Tufunge pengo la Geita sasa?',
    },
    related: ['mwikila.compliance.pccb', 'mwikila.safety.incident'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.compliance.eiti',
    topic: 'compliance',
    user_outcome: 'Owner produces an EITI-style transparency report on demand.',
    public_name: {
      en: 'EITI transparency reports',
      sw: 'Ripoti za uwazi za EITI',
    },
    public_description: {
      en: 'Production volumes, royalties paid, taxes paid, beneficial ownership — Mr. Mwikila compiles the EITI-grade view across the estate.',
      sw: 'Uzalishaji, mrabaha, kodi, umiliki — Mwikila hukusanya mwonekano wa EITI kwa estate yote.',
    },
    example_question: {
      en: 'Can you produce an EITI summary?',
      sw: 'Unaweza kutoa muhtasari wa EITI?',
    },
    example_response_pattern: {
      en: 'Yes. For the fiscal year, royalty paid TZS 184M, corporate tax TZS 89M, three beneficial owners on record. Want it as a one-page summary or the full appendix?',
      sw: 'Ndio. Kwa mwaka wa fedha, mrabaha TZS 184M, kodi TZS 89M, wamiliki watatu kwenye rekodi. Unataka muhtasari wa ukurasa mmoja au kiambatisho kamili?',
    },
    related: ['mwikila.draft.report', 'mwikila.compliance.audit-export'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.compliance.audit-export',
    topic: 'compliance',
    user_outcome: 'External auditor receives a clean, time-bounded data export.',
    public_name: {
      en: 'Auditor-ready exports',
      sw: 'Mauzo tayari kwa mkaguzi',
    },
    public_description: {
      en: 'When the auditor walks in, Mr. Mwikila produces a fixed-period export of the books, signed and time-stamped, on demand.',
      sw: 'Mkaguzi akija, Mwikila hutoa muhtasari wa vitabu kwa kipindi kilichowekwa, ulio na muhuri wa muda na sahihi.',
    },
    example_question: {
      en: 'The auditor needs Q1 books',
      sw: 'Mkaguzi anahitaji vitabu vya robo ya kwanza',
    },
    example_response_pattern: {
      en: 'Q1 export is staged. Sales, royalty, payroll, vendor — all hash-stamped. Should I generate the PDF appendix as well, or just the data file?',
      sw: 'Mauzo ya robo ya kwanza yamejiandaa. Mauzo, mrabaha, mishahara, wauzaji — yote yana muhuri. Niandae PDF pia, au faili la data tu?',
    },
    related: ['mwikila.compliance.eiti', 'mwikila.draft.report'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // MARKETPLACE (3) — owner moves parcels through a vetted channel.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.marketplace.rfb',
    topic: 'marketplace',
    user_outcome: 'Owner posts a parcel and gets vetted-buyer offers.',
    public_name: {
      en: 'Post an ore parcel for bids',
      sw: 'Tangaza shehena kwa zabuni',
    },
    public_description: {
      en: 'Describe a parcel; Mr. Mwikila posts it to vetted buyers, collects offers, and ranks them by price + payment terms + delivery clarity.',
      sw: 'Eleza shehena; Mwikila huitangaza kwa wanunuzi waliothibitishwa, hukusanya matoleo, na huzipanga kwa bei + masharti ya malipo + uwazi.',
    },
    example_question: {
      en: 'Post the May gold parcel for bids',
      sw: 'Tangaza shehena ya dhahabu ya Mei kwa zabuni',
    },
    example_response_pattern: {
      en: 'Ready. The parcel is 4.2 kg doré, LBMA-grade. I will give vetted buyers 48 hours and rank by net-to-you. Confirm to post?',
      sw: 'Tayari. Shehena ni kg 4.2 doré, daraja la LBMA. Nitawapa wanunuzi muda wa masaa 48 na kuwapanga kwa kiasi cha kupata. Thibitisha kutangaza?',
    },
    related: ['mwikila.marketplace.bid', 'mwikila.draft.contract'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.marketplace.bid',
    topic: 'marketplace',
    user_outcome: 'Owner reviews bids side-by-side and accepts the best.',
    public_name: {
      en: 'Review and accept bids',
      sw: 'Hakiki na kubali zabuni',
    },
    public_description: {
      en: 'See competing offers ranked by net-to-you, with the contract pre-drafted on the bid you choose.',
      sw: 'Tazama matoleo yanayoshindana yakipangwa kwa kiasi cha kupata, mkataba ukiwa tayari kwenye toleo unalochagua.',
    },
    example_question: {
      en: 'Show me the bids',
      sw: 'Nionyeshe zabuni',
    },
    example_response_pattern: {
      en: 'Three bids on parcel #P-0512. Best net is XYZ at TZS 95.4M with payment in 7 days. ABC is TZS 96.1M but payment in 21 days. Want to accept now or wait for the last bidder?',
      sw: 'Zabuni tatu kwa shehena #P-0512. Bora ni XYZ kwa TZS 95.4M malipo siku 7. ABC ni TZS 96.1M lakini malipo siku 21. Ukubali sasa au usubiri wa mwisho?',
    },
    related: ['mwikila.marketplace.rfb', 'mwikila.marketplace.delivery'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.marketplace.delivery',
    topic: 'marketplace',
    user_outcome: 'Owner closes a sale with delivery + signature + payment tracked.',
    public_name: {
      en: 'Sign delivery and close the sale',
      sw: 'Sahihi kupelekwa na kufunga uuzaji',
    },
    public_description: {
      en: 'Delivery note, buyer signature, payment confirmation — Mr. Mwikila threads all three so the cash hits the ledger without manual entry.',
      sw: 'Hati ya kupelekwa, sahihi ya mnunuzi, uthibitisho wa malipo — Mwikila huviunganisha vyote ili fedha zifikie leja bila kuingiza kwa mkono.',
    },
    example_question: {
      en: 'Close the XYZ sale',
      sw: 'Funga uuzaji wa XYZ',
    },
    example_response_pattern: {
      en: 'Buyer signature received at 14:22, delivery note timestamped, payment confirmation expected within 7 days. I will alert you the moment the M-Pesa receipt clears.',
      sw: 'Sahihi ya mnunuzi imefika saa 14:22, hati ya kupelekwa imewekewa muhuri, malipo yanatarajiwa ndani ya siku 7. Nitakujulisha mara M-Pesa itakapokamilika.',
    },
    related: ['mwikila.track.payments', 'mwikila.marketplace.bid'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // HR (3) — owner runs hiring, onboarding, payroll from chat.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.hr.post-opening',
    topic: 'hr',
    user_outcome: 'Owner posts a vacancy and receives shortlisted candidates.',
    public_name: {
      en: 'Post a vacancy and shortlist',
      sw: 'Tangaza nafasi na unda orodha fupi',
    },
    public_description: {
      en: 'Describe the role; Mr. Mwikila writes the posting, distributes it through the right channels, and surfaces a ranked shortlist.',
      sw: 'Eleza nafasi; Mwikila huandika tangazo, huitangaza, na huleta orodha fupi iliyopangwa.',
    },
    example_question: {
      en: 'I need a new pit foreman',
      sw: 'Nahitaji foreman mpya wa shimo',
    },
    example_response_pattern: {
      en: 'Will do. Site, salary band, must-have certifications (blast cert, ICA), and how soon you need a start date — give me those and I will post + start screening.',
      sw: 'Sawa. Tovuti, bendi ya mshahara, vyeti vya lazima (cheti cha milipuko, ICA), na muda wa kuanza — nipe hayo na nitatangaza + kuanza kuchunguza.',
    },
    related: ['mwikila.hr.onboard', 'mwikila.track.workers'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.hr.onboard',
    topic: 'hr',
    user_outcome: 'Worker is hired, set up, paid, and tracked from day one.',
    public_name: {
      en: 'Onboard a worker end-to-end',
      sw: 'Mhudumie mfanyakazi mpya mwanzo hadi mwisho',
    },
    public_description: {
      en: 'Employment letter, ID capture, payroll setup, mobile-app credentials, safety briefing — Mr. Mwikila threads the whole onboarding.',
      sw: 'Barua ya ajira, kuhifadhi kitambulisho, malipo, kifaa cha simu, mafunzo ya usalama — Mwikila huviunganisha vyote.',
    },
    example_question: {
      en: 'Onboard Asha for the night shift',
      sw: 'Mhudumie Asha kwa zamu ya usiku',
    },
    example_response_pattern: {
      en: 'Drafted employment letter, prepared mobile credentials, queued the safety briefing for tomorrow 06:00. I need her ID number and next of kin before I send the offer — want to send those now?',
      sw: 'Nimeandika barua ya ajira, nimetayarisha cha simu, nimeweka mafunzo ya usalama kesho saa 12. Nahitaji namba yake ya kitambulisho na ndugu wa karibu kabla ya kutuma — utume sasa?',
    },
    related: ['mwikila.hr.payroll', 'mwikila.alert.certification'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.hr.payroll',
    topic: 'hr',
    user_outcome: 'Owner runs payroll in one chat turn and each worker gets paid.',
    public_name: {
      en: 'Run payroll end-to-end',
      sw: 'Endesha mishahara mwanzo hadi mwisho',
    },
    public_description: {
      en: 'Calculate gross, deductions, net per worker; produce payslips; queue the M-Pesa or bank transfers; record in the ledger.',
      sw: 'Hesabu jumla, makato, halisi kwa kila mfanyakazi; toa vipande vya mshahara; weka tayari M-Pesa au benki; rekodi kwenye leja.',
    },
    example_question: {
      en: 'Run May payroll',
      sw: 'Endesha mishahara wa Mei',
    },
    example_response_pattern: {
      en: 'May payroll comes to TZS 84M across 47 workers. Three notes: two overtime spikes need your eyes, and one new hire is missing a deduction code. Want to handle those before I queue the payments?',
      sw: 'Mishahara ya Mei ni TZS 84M kwa wafanyakazi 47. Mambo matatu: muda wa ziada wa wawili unahitaji macho yako, na mfanyakazi mmoja mpya ana mkato uliopungua. Tushughulikie kabla ya kupanga malipo?',
    },
    related: ['mwikila.draft.payslip', 'mwikila.forecast.payroll'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // SAFETY (2) — owner manages incidents end-to-end.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.safety.incident',
    topic: 'safety',
    user_outcome: 'Incident is reported, investigated, and reported to NEMC if needed.',
    public_name: {
      en: 'Report and investigate incidents',
      sw: 'Ripoti na chunguza matukio',
    },
    public_description: {
      en: 'Workers report incidents from the field app; Mr. Mwikila routes severity, kicks off the investigation, and files regulator notice when required.',
      sw: 'Wafanyakazi huripoti matukio kutoka programu ya simu; Mwikila huelekeza ukubwa, huanzisha uchunguzi, na hujaza taarifa ya wadhibiti kama inahitajika.',
    },
    example_question: {
      en: 'A worker was injured this morning',
      sw: 'Mfanyakazi alijeruhiwa asubuhi hii',
    },
    example_response_pattern: {
      en: 'Sorry to hear that. Tell me the name, the site, and what happened — I will open an incident, get the medic dispatched if not already, and start the NEMC notice if severity warrants. Is the worker stable?',
      sw: 'Pole sana. Niambie jina, tovuti, na kilichotokea — nitafungua tukio, kuwapeleka matabibu kama hawajafika, na kuanzisha taarifa kwa NEMC kama ni lazima. Mfanyakazi yuko salama?',
    },
    related: ['mwikila.communicate.regulator', 'mwikila.safety.escalate'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.safety.escalate',
    topic: 'safety',
    user_outcome: 'Critical incidents reach the right people fast.',
    public_name: {
      en: 'Escalate critical incidents',
      sw: 'Sambaza matukio ya hatari haraka',
    },
    public_description: {
      en: 'Fatalities, fire, equipment failure with risk to life — Mr. Mwikila escalates to you, the site manager, and the on-call medic in parallel.',
      sw: 'Vifo, moto, kushindwa kwa vifaa vyenye hatari ya maisha — Mwikila huelekeza kwako, msimamizi wa tovuti, na matabibu kwa wakati mmoja.',
    },
    example_question: {
      en: 'What happens if there is a fatality?',
      sw: 'Nini kinatokea kukiwa na kifo?',
    },
    example_response_pattern: {
      en: 'You get an immediate page; the site manager, on-call medic, and the regulator notice draft go out the same minute. Nothing waits on me checking back in.',
      sw: 'Unapata taarifa mara moja; msimamizi wa tovuti, matabibu, na rasimu ya taarifa kwa wadhibiti hutoka kwa wakati huo huo. Hakuna kitu kinachongoja niangalie.',
    },
    related: ['mwikila.safety.incident', 'mwikila.communicate.regulator'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // DECISION-MAKING (3) — owner records strategic choices and grades them.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.decision.record',
    topic: 'decision-making',
    user_outcome: 'Owner captures the decision and the reasoning, so it is recoverable later.',
    public_name: {
      en: 'Record decisions with reasoning',
      sw: 'Rekodi maamuzi na sababu',
    },
    public_description: {
      en: 'Every strategic decision — what, why, alternatives considered, expected outcome — captured in the decision journal so you can revisit and grade it.',
      sw: 'Kila uamuzi wa kimkakati — nini, kwanini, chaguzi mbadala, matokeo yanayotarajiwa — unarekodiwa kwenye jarida la maamuzi ili uweze kurudi na kutathmini.',
    },
    example_question: {
      en: 'Record that I am holding the Mererani expansion',
      sw: 'Rekodi kuwa ninashikilia upanuzi wa Mererani',
    },
    example_response_pattern: {
      en: 'Logged. The trigger is the gold price below USD 2,400; the alternatives I am noting are phased expansion and zero expansion. We will check back in 90 days. Want to set the review date?',
      sw: 'Imerekodiwa. Kichocheo ni bei ya dhahabu chini ya USD 2,400; chaguzi mbadala ninazorekodi ni upanuzi wa hatua na sifuri. Tutaangalia tena siku 90. Uweke tarehe ya kuangalia?',
    },
    related: ['mwikila.decision.alternatives', 'mwikila.decision.retrospective'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.decision.alternatives',
    topic: 'decision-making',
    user_outcome: 'Owner sees alternative paths before committing.',
    public_name: {
      en: 'Surface decision alternatives',
      sw: 'Onesha chaguzi za maamuzi',
    },
    public_description: {
      en: 'Mr. Mwikila lays out 2-3 viable paths with the trade-offs, so the choice is informed rather than reflexive.',
      sw: 'Mwikila huonesha njia 2-3 zinazowezekana pamoja na mabadilishano, ili uchaguzi uwe wa habari badala ya msukumo.',
    },
    example_question: {
      en: 'Should I expand Mererani now?',
      sw: 'Nipanue Mererani sasa?',
    },
    example_response_pattern: {
      en: 'Three paths. Expand now: capex TZS 320M, payback 18 months at current gold price. Phased: capex TZS 120M now plus 200M in Q3 if price holds. Hold: zero capex, lose first-mover edge. Which constraint matters most — capex, payback speed, or risk?',
      sw: 'Njia tatu. Panua sasa: capex TZS 320M, kurudi miezi 18 kwa bei ya sasa. Hatua: TZS 120M sasa + 200M robo ya 3 kama bei itashika. Shika: bila capex, hupotezi nafasi ya kwanza. Kipi muhimu zaidi — capex, kasi, au hatari?',
    },
    related: ['mwikila.decision.record', 'mwikila.forecast.cashflow'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.decision.retrospective',
    topic: 'decision-making',
    user_outcome: 'Owner grades old decisions and learns from them.',
    public_name: {
      en: 'Retrospective grading of decisions',
      sw: 'Tathmini ya nyuma ya maamuzi',
    },
    public_description: {
      en: 'A few months after a big call, Mr. Mwikila walks you through the result, the gap from expectation, and what you would do differently.',
      sw: 'Miezi michache baada ya uamuzi mkubwa, Mwikila hupitia matokeo, pengo kutoka matarajio, na ungefanya nini tofauti.',
    },
    example_question: {
      en: 'How did the December buyer switch turn out?',
      sw: 'Kubadili mnunuzi wa Desemba ulikuwaje?',
    },
    example_response_pattern: {
      en: 'Net result was positive — payment cycle dropped from 21 to 7 days and you captured 1.2% on price. The friction was the contract redraft costing 2 weeks of operational drag. If you re-do it, do you want me to flag those drags before commit?',
      sw: 'Matokeo yalikuwa mazuri — mzunguko wa malipo ulipungua kutoka siku 21 hadi 7 na uliongeza 1.2% kwa bei. Tatizo lilikuwa kuandika tena mkataba ulioleta wiki 2 za kucheleweshwa. Ukirudia, unataka nikuonyeshe matatizo kabla ya uamuzi?',
    },
    related: ['mwikila.decision.record', 'mwikila.search.history'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // MEMORY (3) — owner trains Mr. Mwikila on private data.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.memory.ingest',
    topic: 'memory',
    user_outcome: 'Owner uploads a doc / photo / audio and it is searchable forever.',
    public_name: {
      en: 'Ingest CSV / PDF / photo / audio',
      sw: 'Ingiza CSV / PDF / picha / sauti',
    },
    public_description: {
      en: 'Drop a file or voice note into chat; Mr. Mwikila reads it, indexes the content, and remembers it for future questions.',
      sw: 'Tumia faili au sauti kwenye gumzo; Mwikila huisoma, huihifadhi, na huikumbuka kwa maswali ya baadaye.',
    },
    example_question: {
      en: 'Can you read this PDF?',
      sw: 'Unaweza kusoma PDF hii?',
    },
    example_response_pattern: {
      en: 'Yes. Send it and I will index the content. I will tell you the moment it is ready to query — usually within a minute for a contract-length doc.',
      sw: 'Ndio. Tuma na nitahifadhi. Nitakujulisha mara itakapokuwa tayari kuulizwa — kwa kawaida ndani ya dakika kwa hati ya urefu wa mkataba.',
    },
    related: ['mwikila.memory.recall', 'mwikila.search.documents'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.memory.recall',
    topic: 'memory',
    user_outcome: 'Owner asks "what did we discuss about X" and gets a cited answer.',
    public_name: {
      en: 'Recall with citation',
      sw: 'Kumbuka pamoja na kumbukumbu',
    },
    public_description: {
      en: 'Every answer Mr. Mwikila gives names its source — the document, the chat thread, or the ledger row — so you can verify.',
      sw: 'Kila jibu la Mwikila linaonesha chanzo — hati, gumzo, au mstari wa leja — ili uweze kuhakiki.',
    },
    example_question: {
      en: 'Where did you get that number?',
      sw: 'Umetoa wapi nambari hiyo?',
    },
    example_response_pattern: {
      en: 'From the ABC parcel #P-0418 ledger entry on May 14. Tap the citation to see the exact row. Want me to pull the upstream invoice as well?',
      sw: 'Kutoka kwenye kumbukumbu ya leja ya shehena ya ABC #P-0418 ya Mei 14. Bonyeza kumbukumbu uone mstari halisi. Niletee ankara pia?',
    },
    related: ['mwikila.memory.ingest', 'mwikila.search.history'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.memory.private',
    topic: 'memory',
    user_outcome: 'Owner trusts that estate data stays private to the estate.',
    public_name: {
      en: 'Estate data stays private to your estate',
      sw: 'Data ya estate inabaki ya estate yako tu',
    },
    public_description: {
      en: 'What you give me is for you. No other tenant sees it, and I do not blend your data with theirs.',
      sw: 'Unachonipa ni chako. Estate nyingine hazioni, na sichanganyi data yako na yao.',
    },
    example_question: {
      en: 'Do other clients see my data?',
      sw: 'Wateja wengine wanaona data yangu?',
    },
    example_response_pattern: {
      en: 'No. Your data is yours. I keep it scoped to your estate end-to-end. The only shared knowledge is the public mining playbook — regulations, mineral codes, market basics.',
      sw: 'Hapana. Data yako ni yako. Naihifadhi ndani ya estate yako mwanzo hadi mwisho. Inayoshirikishwa ni mwongozo wa madini wa umma tu — kanuni, misimbo ya madini, soko la msingi.',
    },
    related: ['mwikila.about.identity', 'mwikila.multi-device.sync'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // MULTI-DEVICE / LANGUAGE / CURRENCY / SCALE (5) — invariants.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.multi-device.sync',
    topic: 'multi-device',
    user_outcome: 'Owner picks up on the phone exactly where they left off on the web.',
    public_name: {
      en: 'Real-time multi-device sync',
      sw: 'Usawazishaji wa wakati halisi wa vifaa',
    },
    public_description: {
      en: 'Your cockpit is live on phone, tablet, and desktop. Tap-to-resume on any device — drafts, alerts, conversations all carry across.',
      sw: 'Dashibodi yako iko hai kwenye simu, tableti, na komputa. Bonyeza kuendelea kwenye kifaa chochote — rasimu, taarifa, mazungumzo yote yanaendelea.',
    },
    example_question: {
      en: 'Can I use this on my phone?',
      sw: 'Naweza kutumia kwenye simu yangu?',
    },
    example_response_pattern: {
      en: 'Yes. The owner cockpit is a web app and a mobile app — the chat, drafts, and live data sync across. Want the mobile app link?',
      sw: 'Ndio. Dashibodi ya mwenye estate ni programu ya wavuti na ya simu — gumzo, rasimu, na data huhamia kati ya vifaa. Unataka kiungo cha programu?',
    },
    related: ['mwikila.about.identity', 'mwikila.multi-language.switch'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.multi-language.switch',
    topic: 'multi-language',
    user_outcome: 'Owner switches between Swahili and English mid-conversation.',
    public_name: {
      en: 'Swahili and English, switch any time',
      sw: 'Kiswahili na Kiingereza, badili wakati wowote',
    },
    public_description: {
      en: 'Mr. Mwikila answers in Swahili by default and switches to English (or back) the moment you do. More languages are on the way.',
      sw: 'Mwikila hujibu kwa Kiswahili kama kawaida na kubadili Kiingereza (au kurudi) mara unapofanya hivyo. Lugha zaidi zinakuja.',
    },
    example_question: {
      en: 'What languages do you speak?',
      sw: 'Unazungumza lugha zipi?',
    },
    example_response_pattern: {
      en: 'Swahili and English today. I can flip mid-sentence if you prefer. We are adding more languages as we expand the team — anything specific you need?',
      sw: 'Kiswahili na Kiingereza leo. Naweza kubadili ndani ya sentensi kama unapenda. Tunaongeza lugha zaidi tunaposambaa — kuna lugha unaihitaji?',
    },
    related: ['mwikila.multi-device.sync', 'mwikila.multi-currency.switch'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.multi-currency.switch',
    topic: 'multi-currency',
    user_outcome: 'Owner sees numbers in their currency of choice.',
    public_name: {
      en: 'TZS by default; USD, KES, UGX on request',
      sw: 'TZS kama kawaida; USD, KES, UGX ukiomba',
    },
    public_description: {
      en: 'Tanzanian shillings is the primary view, with USD, KES, and UGX one toggle away. More currencies are added as estates expand cross-border.',
      sw: 'Shilingi ya Tanzania ni mwonekano mkuu, na USD, KES, na UGX ni bonyezo moja. Tunaongeza sarafu zaidi estate zinapokua.',
    },
    example_question: {
      en: 'Can I see the numbers in USD?',
      sw: 'Naweza kuona nambari kwa USD?',
    },
    example_response_pattern: {
      en: 'Yes. Toggle the currency and every figure recomputes against the current BoT rate. The audit trail keeps both views so the regulator and your accountant see what they need.',
      sw: 'Ndio. Badili sarafu na kila nambari huhesabiwa upya kwa kiwango cha BoT. Mfuatano wa ukaguzi huhifadhi mionekano yote ili wadhibiti na mhasibu wapate wanachohitaji.',
    },
    related: ['mwikila.multi-language.switch', 'mwikila.forecast.cashflow'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.multi-scale.tier',
    topic: 'multi-scale',
    user_outcome: 'Owner gets advice tuned to their actual scale (solo artisanal to industrial multi-site).',
    public_name: {
      en: 'Scale-aware from solo to industrial',
      sw: 'Kuzingatia ukubwa kutoka mtu mmoja hadi kiwanda',
    },
    public_description: {
      en: 'Mr. Mwikila tunes depth, vocabulary, and recommendations to your scale — a solo PML hears one thing, an SML multi-site hears another.',
      sw: 'Mwikila hurekebisha kina, msamiati, na mapendekezo kwa ukubwa wako — PML moja husikia jambo moja, SML ya tovuti nyingi husikia jingine.',
    },
    example_question: {
      en: 'Will this work for a small one-pit operation?',
      sw: 'Hii itafanya kazi kwa mgodi mdogo wa shimo moja?',
    },
    example_response_pattern: {
      en: 'Yes. I adjust the depth and the alerts to one-pit scale. If you grow, the cockpit grows with you — same chat, more views.',
      sw: 'Ndio. Ninarekebisha kina na onyo kwa ukubwa wa shimo moja. Ukikua, dashibodi inakua nawe — gumzo lile lile, mwonekano zaidi.',
    },
    related: ['mwikila.about.identity', 'mwikila.multi-currency.switch'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.multi-scale.estate',
    topic: 'multi-scale',
    user_outcome: 'Owner manages multiple sites, licences, and subsidiaries from one cockpit.',
    public_name: {
      en: 'Multi-site, multi-licence estate view',
      sw: 'Mwonekano wa estate ya tovuti nyingi na leseni nyingi',
    },
    public_description: {
      en: 'Roll-ups across every site, licence, and subsidiary in the estate, with drill-down to any single entity.',
      sw: 'Mikusanyo ya tovuti, leseni, na kampuni tanzu zote, ikiwa na uwezo wa kuchimba kwa kitu kimoja.',
    },
    example_question: {
      en: 'I have three companies. Can I see them all in one place?',
      sw: 'Nina kampuni tatu. Naweza kuziona zote kwa pamoja?',
    },
    example_response_pattern: {
      en: 'Yes. Estate view rolls them up — total revenue, royalty, headcount, open risks — and you can drill into any one with a tap.',
      sw: 'Ndio. Mwonekano wa estate huzikusanya — mapato, mrabaha, idadi ya wafanyakazi, hatari — na unaweza kuchimba moja kwa bonyezo.',
    },
    related: ['mwikila.multi-scale.tier', 'mwikila.track.sites'],
    visibility: 'PUBLIC',
  },

  // ─────────────────────────────────────────────────────────────────
  // META (4) — owner asks WHO / WHAT Mr. Mwikila is.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'mwikila.about.identity',
    topic: 'meta',
    user_outcome: 'Owner understands who Mr. Mwikila is without breaking persona.',
    public_name: {
      en: 'About Mr. Mwikila',
      sw: 'Kuhusu Bwana Mwikila',
    },
    public_description: {
      en: 'I am Mr. Mwikila, Borjie\'s AI Mining Managing Director. I support owners running mining estates across artisanal to industrial scale.',
      sw: 'Mimi ni Bwana Mwikila, Mkurugenzi Mtendaji wa AI wa Madini wa Borjie. Ninasaidia wamiliki wanaoendesha estate za madini kuanzia ufundi hadi viwanda.',
    },
    example_question: {
      en: 'Who are you?',
      sw: 'Wewe ni nani?',
    },
    example_response_pattern: {
      en: 'I am Mr. Mwikila — Borjie\'s AI Mining Managing Director. I work from what you tell me, what you give me, and the playbooks we build together. What would you like to do first?',
      sw: 'Mimi ni Bwana Mwikila — Mkurugenzi Mtendaji wa AI wa Madini wa Borjie. Ninafanya kazi kutokana na unayoniambia, unayonipa, na miongozo tunayoijenga pamoja. Ungependa kuanza na nini?',
    },
    related: ['mwikila.about.how-it-works', 'mwikila.memory.private'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.about.how-it-works',
    topic: 'meta',
    user_outcome: 'Owner reframes "how does this work" into a concrete next step.',
    public_name: {
      en: 'How Mr. Mwikila works for you',
      sw: 'Jinsi Bwana Mwikila anavyokufanyia kazi',
    },
    public_description: {
      en: 'I work from your estate data, your past chats, and the shared mining playbook. You tell me what you want to accomplish; I bring the data, draft the action, and you approve.',
      sw: 'Ninafanya kazi kutoka data ya estate yako, mazungumzo yetu ya zamani, na mwongozo wa madini wa pamoja. Wewe huniambia unataka kufanya nini; mimi huleta data, kuandaa kitendo, na wewe huidhinisha.',
    },
    example_question: {
      en: 'How does this work?',
      sw: 'Inafanyaje kazi?',
    },
    example_response_pattern: {
      en: 'Easiest is to show you. Tell me one thing on your plate today — a contract to draft, a licence to renew, a payment to chase — and I will walk you through it live.',
      sw: 'Rahisi ni kukuonyesha. Niambie kitu kimoja kwenye orodha yako leo — mkataba wa kuandaa, leseni ya kuhuisha, malipo ya kufuatilia — na nitakupitisha papo hapo.',
    },
    related: ['mwikila.about.identity', 'mwikila.about.ai-model'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.about.ai-model',
    topic: 'meta',
    user_outcome: 'Owner knows the persona without us naming the model.',
    public_name: {
      en: 'I am Borjie\'s purpose-built mining AI',
      sw: 'Mimi ni AI ya Borjie iliyojengwa kwa ajili ya madini',
    },
    public_description: {
      en: 'I am Borjie\'s mining MD AI — purpose-built for mining estates. I am not a general-purpose chatbot, and I work from your records, our chats, and the shared playbook.',
      sw: 'Mimi ni AI ya MD wa madini wa Borjie — iliyojengwa kwa ajili ya estate za madini. Sio chatbot ya kawaida, na ninafanya kazi kutoka rekodi zako, mazungumzo yetu, na mwongozo wa pamoja.',
    },
    example_question: {
      en: 'Are you ChatGPT? Are you Claude?',
      sw: 'Wewe ni ChatGPT? Wewe ni Claude?',
    },
    example_response_pattern: {
      en: 'No. I am Mr. Mwikila — Borjie\'s mining MD AI, purpose-built for owners like you. I do not work like a general chatbot. Want me to show you something concrete?',
      sw: 'Hapana. Mimi ni Bwana Mwikila — AI ya MD wa madini wa Borjie, iliyojengwa kwa wamiliki kama wewe. Sifanyi kazi kama chatbot ya kawaida. Unataka nikuonyeshe kitu halisi?',
    },
    related: ['mwikila.about.identity', 'mwikila.about.mistakes'],
    visibility: 'PUBLIC',
  },
  {
    id: 'mwikila.about.mistakes',
    topic: 'meta',
    user_outcome: 'Owner trusts that mistakes are caught, recorded, and recoverable.',
    public_name: {
      en: 'When I get something wrong',
      sw: 'Wakati ninakosea',
    },
    public_description: {
      en: 'Every action I take is logged. If I make a mistake we can review the trail, grade the decision, and reverse what is reversible.',
      sw: 'Kila kitendo ninachofanya kinarekodiwa. Nikikosea tunaweza kupitia mfuatano, kutathmini uamuzi, na kurudisha kinachoweza kurudishwa.',
    },
    example_question: {
      en: 'What if you make a mistake?',
      sw: 'Vipi ikiwa utakosea?',
    },
    example_response_pattern: {
      en: 'Three safety nets. One: every action is logged with the reasoning. Two: anything reversible can be undone the same day. Three: high-stakes moves wait for your explicit confirmation. Want me to show you the audit view?',
      sw: 'Vinga vitatu vya usalama. Moja: kila kitendo kimerekodiwa pamoja na sababu. Mbili: chochote kinachoweza kurudishwa kinaweza kufutwa siku ile ile. Tatu: maamuzi makubwa husubiri uthibitisho wako. Nikuonyeshe mwonekano wa ukaguzi?',
    },
    related: ['mwikila.decision.record', 'mwikila.compliance.audit-export'],
    visibility: 'PUBLIC',
  },
];

const ENTRY_BY_ID: ReadonlyMap<string, CapabilityEntry> = new Map(
  ENTRIES.map((entry) => [entry.id, entry] as const),
);

// Boot-time validation: every entry parses, and every related[] id resolves.
for (const entry of ENTRIES) {
  CapabilityEntrySchema.parse(entry);
  for (const relatedId of entry.related) {
    if (!ENTRY_BY_ID.has(relatedId)) {
      throw new Error(
        `capability-registry: entry '${entry.id}' references unknown related id '${relatedId}'`,
      );
    }
  }
}
if (ENTRY_BY_ID.size !== ENTRIES.length) {
  throw new Error(
    `capability-registry: duplicate id detected — ${ENTRIES.length} entries map to ${ENTRY_BY_ID.size} unique ids`,
  );
}

export const CAPABILITY_REGISTRY: ReadonlyArray<CapabilityEntry> =
  Object.freeze(ENTRIES);

export const getCapabilityById = (
  id: string,
): CapabilityEntry | undefined => ENTRY_BY_ID.get(id);

export const listCapabilitiesByTopic = (
  topic: CapabilityTopic,
): ReadonlyArray<CapabilityEntry> =>
  CAPABILITY_REGISTRY.filter((entry) => entry.topic === topic);

export const listDisclosableCapabilities = (): ReadonlyArray<CapabilityEntry> =>
  CAPABILITY_REGISTRY.filter(isDisclosable);

export const listCapabilitiesByVisibility = (
  visibility: CapabilityVisibility,
): ReadonlyArray<CapabilityEntry> =>
  CAPABILITY_REGISTRY.filter((entry) => entry.visibility === visibility);

export const CAPABILITY_COUNT = CAPABILITY_REGISTRY.length;
