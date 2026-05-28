/**
 * Slash-command catalog — per-role command set surfaced by the mobile
 * composer's `/` menu. The brain ultimately routes the typed slug to
 * the matching persona-gated tool; this catalog drives ONLY the menu
 * rendering, not the tool execution path.
 *
 * Each command carries:
 *   - id         the slash token (after the leading `/`)
 *   - label      bilingual sw/en (chooses on locale)
 *   - hint       bilingual sw/en short caption
 *   - personaSlugs personas allowed to invoke this command
 *
 * The brain resolves the command id to the tool id via the persona's
 * `toolCatalogIds`. Adding a command here does NOT grant access — the
 * persona must already be allowed to call the tool.
 *
 * 5–8 commands per role per the brief.
 */

export interface MobileSlashCommand {
  readonly id: string;
  readonly label: { readonly en: string; readonly sw: string };
  readonly hint: { readonly en: string; readonly sw: string };
  readonly personaSlugs: ReadonlyArray<string>;
}

const OWNER: ReadonlyArray<string> = ['T1_owner_strategist'];
const MANAGER: ReadonlyArray<string> = [
  'T1_manager_dispatch',
  'T3_module_manager',
];
const SUPERVISOR: ReadonlyArray<string> = ['T1_supervisor_shift'];
const PIT: ReadonlyArray<string> = ['T1_pit_operator', 'T4_field_employee'];
const GEO: ReadonlyArray<string> = ['T1_geologist'];
const TREASURY: ReadonlyArray<string> = ['T1_treasury_clerk'];
const SAFETY: ReadonlyArray<string> = ['T1_safety_officer'];
const COMPLIANCE: ReadonlyArray<string> = ['T1_compliance_clerk'];
const BUYER: ReadonlyArray<string> = [
  'T1_buyer_marketplace_director',
  'T5_customer_concierge',
];

/**
 * Workforce slash-command catalog. Returned as a frozen tuple so the
 * mobile composer can pass it directly into the menu filter.
 */
export const WORKFORCE_SLASH_COMMANDS: ReadonlyArray<MobileSlashCommand> =
  Object.freeze([
    // Owner (mobile)
    {
      id: 'brief',
      label: { en: 'Daily brief', sw: 'Muhtasari wa siku' },
      hint: { en: 'Show today snapshot', sw: 'Onyesha ufupisho wa leo' },
      personaSlugs: OWNER,
    },
    {
      id: 'cash',
      label: { en: 'Cash and runway', sw: 'Hela na muda' },
      hint: { en: 'Treasury status', sw: 'Hali ya hazina' },
      personaSlugs: OWNER,
    },
    {
      id: 'decisions',
      label: { en: 'Pending decisions', sw: 'Maamuzi yanayosubiri' },
      hint: { en: 'Approvals waiting', sw: 'Idhinisho zinazosubiri' },
      personaSlugs: OWNER,
    },
    {
      id: 'crew',
      label: { en: 'Crew status', sw: 'Hali ya timu' },
      hint: { en: 'Who is on shift', sw: 'Nani yuko kazini' },
      personaSlugs: [...MANAGER, ...SUPERVISOR],
    },
    {
      id: 'dispatch',
      label: { en: 'Dispatch board', sw: 'Bodi ya utumaji' },
      hint: { en: 'Equipment routing', sw: 'Utumaji wa vifaa' },
      personaSlugs: MANAGER,
    },
    {
      id: 'incidents',
      label: { en: 'Recent incidents', sw: 'Ajali za karibuni' },
      hint: { en: 'Last 7 days', sw: 'Siku 7 zilizopita' },
      personaSlugs: [...MANAGER, ...SUPERVISOR, ...SAFETY],
    },
    {
      id: 'approvals',
      label: { en: 'Pending approvals', sw: 'Idhinisho zinazosubiri' },
      hint: { en: 'For your sign-off', sw: 'Zinazohitaji idhini yako' },
      personaSlugs: MANAGER,
    },
    // Supervisor
    {
      id: 'shift',
      label: { en: 'My shift today', sw: 'Zamu yangu leo' },
      hint: { en: 'Roster + tasks', sw: 'Zamu na kazi' },
      personaSlugs: [...SUPERVISOR, ...PIT],
    },
    {
      id: 'clock-in',
      label: { en: 'Clock in', sw: 'Ingia kazini' },
      hint: { en: 'Start your shift', sw: 'Anza zamu' },
      personaSlugs: [...SUPERVISOR, ...PIT],
    },
    {
      id: 'clock-out',
      label: { en: 'Clock out', sw: 'Toka kazini' },
      hint: { en: 'End your shift', sw: 'Maliza zamu' },
      personaSlugs: [...SUPERVISOR, ...PIT],
    },
    {
      id: 'tasks',
      label: { en: 'My tasks', sw: 'Kazi zangu' },
      hint: { en: 'Open work items', sw: 'Kazi zilizoanzishwa' },
      personaSlugs: [...SUPERVISOR, ...PIT, ...GEO],
    },
    {
      id: 'toolbox',
      label: { en: 'Toolbox talk', sw: 'Mazungumzo ya usalama' },
      hint: { en: 'Acknowledge today', sw: 'Thibitisha leo' },
      personaSlugs: [...SUPERVISOR, ...PIT, ...SAFETY],
    },
    {
      id: 'incident-report',
      label: { en: 'Report incident', sw: 'Ripoti ajali' },
      hint: { en: 'Log a safety event', sw: 'Andika tukio la usalama' },
      personaSlugs: [...SUPERVISOR, ...PIT, ...SAFETY],
    },
    // Geologist
    {
      id: 'sample',
      label: { en: 'Submit sample', sw: 'Wasilisha sampuli' },
      hint: { en: 'Drill core or grab', sw: 'Sampuli ya kuchimba' },
      personaSlugs: GEO,
    },
    {
      id: 'drill-log',
      label: { en: 'Drill log', sw: 'Logi ya kuchimba' },
      hint: { en: 'Today depth + grade', sw: 'Kina na ubora wa leo' },
      personaSlugs: GEO,
    },
    {
      id: 'assay',
      label: { en: 'Assay results', sw: 'Matokeo ya uchunguzi' },
      hint: { en: 'Latest lab reports', sw: 'Ripoti za karakana' },
      personaSlugs: GEO,
    },
    // Treasury
    {
      id: 'cashflow',
      label: { en: 'Cashflow', sw: 'Mtiririko wa fedha' },
      hint: { en: 'In / out today', sw: 'Ndani na nje leo' },
      personaSlugs: TREASURY,
    },
    {
      id: 'payouts',
      label: { en: 'Pending payouts', sw: 'Malipo yanayosubiri' },
      hint: { en: 'Workers + suppliers', sw: 'Wafanyakazi na wauzaji' },
      personaSlugs: TREASURY,
    },
    {
      id: 'royalty',
      label: { en: 'Royalty status', sw: 'Hali ya kodi ya mrahaba' },
      hint: { en: 'Government dues', sw: 'Madeni ya serikali' },
      personaSlugs: TREASURY,
    },
    // Safety officer
    {
      id: 'incidents-open',
      label: { en: 'Open incidents', sw: 'Ajali wazi' },
      hint: { en: 'Awaiting close-out', sw: 'Zinazosubiri kufungwa' },
      personaSlugs: SAFETY,
    },
    {
      id: 'ppe-check',
      label: { en: 'PPE check', sw: 'Ukaguzi wa vifaa vya ulinzi' },
      hint: { en: 'Inspection log', sw: 'Logi ya ukaguzi' },
      personaSlugs: SAFETY,
    },
    // Compliance clerk
    {
      id: 'licences',
      label: { en: 'Licences', sw: 'Leseni' },
      hint: { en: 'Expiry + status', sw: 'Kuisha muda na hali' },
      personaSlugs: COMPLIANCE,
    },
    {
      id: 'audit-trail',
      label: { en: 'Audit trail', sw: 'Njia ya ukaguzi' },
      hint: { en: 'Recent entries', sw: 'Maingizo ya karibuni' },
      personaSlugs: COMPLIANCE,
    },
    {
      id: 'reports',
      label: { en: 'Reports', sw: 'Ripoti' },
      hint: { en: 'Compliance set', sw: 'Seti ya utii' },
      personaSlugs: COMPLIANCE,
    },
  ]);

/**
 * Buyer slash-command catalog. Used by the buyer-mobile chat composer.
 * Personas: T1_buyer_marketplace_director (face) + T5_customer_concierge
 * (legacy fallback).
 */
export const BUYER_SLASH_COMMANDS: ReadonlyArray<MobileSlashCommand> =
  Object.freeze([
    {
      id: 'search',
      label: { en: 'Search parcels', sw: 'Tafuta mizigo' },
      hint: { en: 'By mineral + price', sw: 'Kwa madini na bei' },
      personaSlugs: BUYER,
    },
    {
      id: 'listing',
      label: { en: 'Listing detail', sw: 'Maelezo ya orodha' },
      hint: { en: 'Open a parcel', sw: 'Fungua mzigo' },
      personaSlugs: BUYER,
    },
    {
      id: 'place-bid',
      label: { en: 'Place a bid', sw: 'Weka zabuni' },
      hint: { en: 'Submit a price', sw: 'Wasilisha bei' },
      personaSlugs: BUYER,
    },
    {
      id: 'my-bids',
      label: { en: 'My bids', sw: 'Zabuni zangu' },
      hint: { en: 'Active + history', sw: 'Hai na historia' },
      personaSlugs: BUYER,
    },
    {
      id: 'market-intel',
      label: { en: 'Market intel', sw: 'Habari za soko' },
      hint: { en: 'LBMA + trend', sw: 'Bei na mwelekeo' },
      personaSlugs: BUYER,
    },
    {
      id: 'chain-of-custody',
      label: { en: 'Chain of custody', sw: 'Mlolongo wa umiliki' },
      hint: { en: 'Parcel timeline', sw: 'Historia ya mzigo' },
      personaSlugs: BUYER,
    },
    {
      id: 'kyc',
      label: { en: 'KYC status', sw: 'Hali ya KYC' },
      hint: { en: 'Verification stage', sw: 'Hatua ya uthibitisho' },
      personaSlugs: BUYER,
    },
    {
      id: 'accept-offer',
      label: { en: 'Accept offer', sw: 'Kubali ofa' },
      hint: { en: 'Take a counter', sw: 'Pokea ofa ya kupinga' },
      personaSlugs: BUYER,
    },
  ]);

/**
 * Look up slash commands available for a given persona slug. The
 * composer typically calls this once and stores the result.
 */
export function slashCommandsForPersona(
  personaSlug: string,
  app: 'workforce' | 'buyer',
): ReadonlyArray<MobileSlashCommand> {
  const catalog =
    app === 'workforce' ? WORKFORCE_SLASH_COMMANDS : BUYER_SLASH_COMMANDS;
  return catalog.filter((cmd) => cmd.personaSlugs.includes(personaSlug));
}
