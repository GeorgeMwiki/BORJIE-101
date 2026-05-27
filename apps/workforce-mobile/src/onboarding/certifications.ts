/**
 * Worker certifications recognised by the Borjie onboarding wizard. The
 * literal values mirror the `Certification` enum in
 * `@borjie/mining-shift-planner` (packages/mining-shift-planner/src/types.ts)
 * so that downstream OSHA-TZ rule evaluation can consume the captured set
 * verbatim once the planner package is wired into workforce-mobile's
 * dependency graph. Keep this list in sync with the planner package.
 */
export const CERTIFICATIONS = [
  'haul-truck-license',
  'excavator-license',
  'underground-cert',
  'blaster-permit',
  'first-aid',
  'crusher-operator',
  'electrician-class-b',
  'confined-space'
] as const

export type Certification = (typeof CERTIFICATIONS)[number]

export function isCertification(value: unknown): value is Certification {
  return typeof value === 'string' && (CERTIFICATIONS as readonly string[]).includes(value)
}
