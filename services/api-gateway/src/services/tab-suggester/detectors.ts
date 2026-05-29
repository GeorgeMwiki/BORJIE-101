/**
 * Tab-suggester pattern detectors (CT-6).
 *
 * Pure functions. The runner feeds them the relevant observation
 * windows; each detector returns 0 or 1 candidate proposal (we never
 * spam the owner with N proposals from one tick — quality > quantity).
 *
 * Confidence is heuristic:
 *   - drill_down_repeat:    0.7 base + 0.05 per repeat above the floor
 *   - navigation_loop:      0.6 base + 0.05 per loop above the floor
 *   - mwikila_escalation:   0.65 base + 0.1 per extra T0/T1 in window
 *
 * Capped at 0.95 to leave room for genuinely high-confidence sources.
 */

// ─── Shared types ────────────────────────────────────────────────────

export interface DetectorResult {
  readonly detector:
    | 'drill_down_repeat'
    | 'navigation_loop'
    | 'mwikila_escalation';
  readonly tabType: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly reasonEn: string;
  readonly reasonSw: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number;
  readonly config: Record<string, unknown>;
}

export interface DetectorInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly now: Date;
}

// ─── Drill-down repeat ───────────────────────────────────────────────

/**
 * One owner navigation into a particular tab type, scoped to a focus
 * phrase (e.g. siteId / licenceId / counterpartyId / free-form focus).
 */
export interface DrillDownObservation {
  readonly id: string;
  readonly tabType: string;
  readonly focus: string;
  readonly occurredAt: Date;
}

const DRILL_DOWN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DRILL_DOWN_FLOOR = 3;

/**
 * Returns a proposal when an owner has drilled into the SAME
 * (tabType, focus) ≥3 times in the trailing 7 days.
 */
export function detectDrillDownRepeat(
  input: DetectorInput,
  observations: ReadonlyArray<DrillDownObservation>,
): DetectorResult | null {
  const cutoffMs = input.now.getTime() - DRILL_DOWN_WINDOW_MS;
  const fresh = observations.filter(
    (o) => o.occurredAt.getTime() >= cutoffMs,
  );
  const grouped = new Map<string, DrillDownObservation[]>();
  for (const o of fresh) {
    const key = `${o.tabType}|${o.focus}`;
    const list = grouped.get(key);
    if (list) list.push(o);
    else grouped.set(key, [o]);
  }
  // Pick the densest qualifying group (most repeats wins).
  let best: { key: string; list: DrillDownObservation[] } | null = null;
  for (const [key, list] of grouped) {
    if (list.length < DRILL_DOWN_FLOOR) continue;
    if (!best || list.length > best.list.length) best = { key, list };
  }
  if (!best) return null;
  const head = best.list[0];
  if (!head) return null;
  const repeats = best.list.length;
  const evidence = best.list
    .slice(0, 5)
    .map((o) => `nav:${o.id}`);
  const confidence = Math.min(0.95, 0.7 + (repeats - DRILL_DOWN_FLOOR) * 0.05);
  return {
    detector: 'drill_down_repeat',
    tabType: head.tabType,
    titleEn: `Pin ${capitalize(head.tabType)}: ${head.focus}`,
    titleSw: `Bandika ${capitalize(head.tabType)}: ${head.focus}`,
    reasonEn: `You drilled into ${head.focus} ${repeats} times this week`,
    reasonSw: `Umechunguza ${head.focus} mara ${repeats} wiki hii`,
    evidenceIds: evidence,
    confidence,
    config: { focus: head.focus },
  };
}

// ─── Navigation loop ─────────────────────────────────────────────────

export interface NavigationObservation {
  readonly id: string;
  readonly route: string;
  readonly occurredAt: Date;
}

const NAV_WINDOW_MS = 24 * 60 * 60 * 1000;
const NAV_FLOOR = 4;

const ROUTE_TO_TAB_TYPE: ReadonlyMap<string, string> = new Map<string, string>([
  ['/compliance', 'compliance'],
  ['/compliance/licences', 'licences'],
  ['/finance', 'finance'],
  ['/finance/royalties', 'finance'],
  ['/workforce', 'workforce'],
  ['/sites', 'sites'],
  ['/risk', 'risk'],
  ['/treasury', 'treasury'],
  ['/marketplace', 'marketplace'],
  ['/audit', 'audit'],
]);

function routeToTabType(route: string): string | null {
  // Exact match first, then prefix.
  if (ROUTE_TO_TAB_TYPE.has(route)) return ROUTE_TO_TAB_TYPE.get(route) ?? null;
  for (const [prefix, type] of ROUTE_TO_TAB_TYPE) {
    if (route.startsWith(prefix + '/')) return type;
  }
  return null;
}

/**
 * Owner is bouncing between the same N pages a lot — propose pinning
 * the corresponding tab so they can stay in context.
 */
export function detectNavigationLoop(
  input: DetectorInput,
  observations: ReadonlyArray<NavigationObservation>,
): DetectorResult | null {
  const cutoffMs = input.now.getTime() - NAV_WINDOW_MS;
  const fresh = observations.filter(
    (o) => o.occurredAt.getTime() >= cutoffMs,
  );
  const grouped = new Map<string, NavigationObservation[]>();
  for (const o of fresh) {
    const list = grouped.get(o.route);
    if (list) list.push(o);
    else grouped.set(o.route, [o]);
  }
  let best: { route: string; list: NavigationObservation[] } | null = null;
  for (const [route, list] of grouped) {
    if (list.length < NAV_FLOOR) continue;
    if (!best || list.length > best.list.length) best = { route, list };
  }
  if (!best) return null;
  const tabType = routeToTabType(best.route);
  if (!tabType) return null;
  const evidence = best.list.slice(0, 5).map((o) => `nav:${o.id}`);
  const confidence = Math.min(0.95, 0.6 + (best.list.length - NAV_FLOOR) * 0.05);
  return {
    detector: 'navigation_loop',
    tabType,
    titleEn: `Pin ${capitalize(tabType)} (visited ${best.list.length}× in 24h)`,
    titleSw: `Bandika ${capitalize(tabType)} (mara ${best.list.length} ndani ya saa 24)`,
    reasonEn: `You visited ${best.route} ${best.list.length} times today`,
    reasonSw: `Umetembelea ${best.route} mara ${best.list.length} leo`,
    evidenceIds: evidence,
    confidence,
    config: {},
  };
}

// ─── Mwikila escalation ──────────────────────────────────────────────

export interface MwikilaObservation {
  readonly id: string;
  readonly category: string;
  readonly tier: 'T0' | 'T1' | 'T2' | 'T3';
  readonly occurredAt: Date;
}

const MW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MW_FLOOR = 2;

const CATEGORY_TO_TAB_TYPE: ReadonlyMap<string, string> = new Map<string, string>([
  ['compliance', 'compliance'],
  ['royalty', 'finance'],
  ['workforce', 'workforce'],
  ['safety', 'safety'],
  ['fx', 'treasury'],
  ['licence', 'licences'],
  ['marketplace', 'marketplace'],
  ['audit', 'audit'],
]);

/**
 * The owner has had ≥2 T0/T1 Mr. Mwikila proposals in the same
 * category over the last 7 days — propose pinning a tab for that
 * domain so the owner can monitor it directly.
 */
export function detectMwikilaEscalation(
  input: DetectorInput,
  observations: ReadonlyArray<MwikilaObservation>,
): DetectorResult | null {
  const cutoffMs = input.now.getTime() - MW_WINDOW_MS;
  const fresh = observations.filter(
    (o) =>
      o.occurredAt.getTime() >= cutoffMs &&
      (o.tier === 'T0' || o.tier === 'T1'),
  );
  const grouped = new Map<string, MwikilaObservation[]>();
  for (const o of fresh) {
    const list = grouped.get(o.category);
    if (list) list.push(o);
    else grouped.set(o.category, [o]);
  }
  let best: { category: string; list: MwikilaObservation[] } | null = null;
  for (const [category, list] of grouped) {
    if (list.length < MW_FLOOR) continue;
    if (!best || list.length > best.list.length) best = { category, list };
  }
  if (!best) return null;
  const tabType = CATEGORY_TO_TAB_TYPE.get(best.category);
  if (!tabType) return null;
  const evidence = best.list.slice(0, 5).map((o) => `mwa:${o.id}`);
  const confidence = Math.min(0.95, 0.65 + (best.list.length - MW_FLOOR) * 0.1);
  return {
    detector: 'mwikila_escalation',
    tabType,
    titleEn: `Pin ${capitalize(tabType)} — Mr. Mwikila escalations`,
    titleSw: `Bandika ${capitalize(tabType)} — escalations za Mr. Mwikila`,
    reasonEn: `Mr. Mwikila has escalated ${best.list.length} ${best.category} items this week`,
    reasonSw: `Mr. Mwikila ameongeza ${best.list.length} vipengele vya ${best.category} wiki hii`,
    evidenceIds: evidence,
    confidence,
    config: { focus: best.category },
  };
}

// ─── tiny helpers ────────────────────────────────────────────────────

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
