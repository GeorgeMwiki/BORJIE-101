/**
 * Route → sub-persona resolver.
 *
 * Given the current path + portal, returns the SubPersona the backend
 * router should wake up first. Path-prefix rules are ordered by specificity:
 * the first match wins. Pure functions only — safe to call from render.
 */
import type { PortalId, SubPersona, RouteContext } from './types';

interface RouteRule {
  readonly portal?: PortalId;
  readonly prefix: string;
  readonly persona: SubPersona;
}

const RULES: readonly RouteRule[] = [
  { prefix: '/admin/arrears', persona: 'finance' },
  { prefix: '/admin/collections', persona: 'finance' },
  { prefix: '/admin/ai/finance', persona: 'finance' },
  { prefix: '/financial', persona: 'finance' },
  { prefix: '/payments', persona: 'finance' },
  { prefix: '/budgets', persona: 'finance' },
  { prefix: '/disbursements', persona: 'finance' },
  { prefix: '/maintenance', persona: 'maintenance' },
  { prefix: '/work-orders', persona: 'maintenance' },
  { prefix: '/inspections', persona: 'maintenance' },
  { prefix: '/vendors', persona: 'maintenance' },
  { prefix: '/lease', persona: 'leasing' },
  { prefix: '/leases', persona: 'leasing' },
  { prefix: '/negotiations', persona: 'leasing' },
  { prefix: '/tenants', persona: 'leasing' },
  { prefix: '/compliance', persona: 'compliance' },
  { prefix: '/audit', persona: 'compliance' },
  { prefix: '/training', persona: 'learning' },
  { prefix: '/assistant/training', persona: 'learning' },
  { prefix: '/coworker/training', persona: 'learning' },
  { prefix: '/advisor', persona: 'advisor' },
  { prefix: '/portfolio', persona: 'advisor' },
  { prefix: '/analytics', persona: 'advisor' },
];

const ENTITY_PATTERN = /\b(case|unit|property|tenant|invoice|lease)[-_ ]?([A-Za-z0-9-]+)\b/gi;

export function resolveSubPersona(path: string, portal: PortalId): SubPersona {
  const lower = path.toLowerCase();
  for (const rule of RULES) {
    if (rule.portal && rule.portal !== portal) continue;
    if (lower.startsWith(rule.prefix)) return rule.persona;
  }
  return 'general';
}

export function extractEntityMentions(path: string): readonly string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(ENTITY_PATTERN.source, 'gi');
  while ((m = re.exec(path)) !== null) {
    matches.push(`${m[1].toLowerCase()}:${m[2]}`);
  }
  return Object.freeze(matches);
}

export function buildRouteContext(path: string, portal: PortalId): RouteContext {
  return {
    path,
    portal,
    entityMentions: extractEntityMentions(path),
    activeSubPersona: resolveSubPersona(path, portal),
  };
}

export function routeContextsEqual(a: RouteContext, b: RouteContext): boolean {
  if (a.path !== b.path) return false;
  if (a.portal !== b.portal) return false;
  if (a.activeSubPersona !== b.activeSubPersona) return false;
  if (a.entityMentions.length !== b.entityMentions.length) return false;
  for (let i = 0; i < a.entityMentions.length; i++) {
    if (a.entityMentions[i] !== b.entityMentions[i]) return false;
  }
  return true;
}
