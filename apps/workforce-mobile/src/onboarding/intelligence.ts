import type { Lang } from '../auth/types'
import type { Role } from '../roles/types'
import { CERTIFICATIONS, type Certification } from './certifications'
import type { AiTone } from './state'

/**
 * Intelligence layer for the onboarding wizard. Today these are deterministic
 * keyword classifiers tuned for the Tanzanian ASM vocabulary; tomorrow each
 * function is a stable interface that `@borjie/brain-llm-router` can swap
 * with an LLM-backed implementation without changing call sites. The wizard
 * is the pluggable boundary — keep the input/output shapes stable.
 *
 * Evidence-required AI: every classification returns the matched keywords so
 * the `@borjie/cognitive-composition` auditor can verify the decision later.
 */

export interface RoleClassification {
  readonly role: Role
  readonly confidence: number
  readonly matchedKeywords: ReadonlyArray<string>
}

interface KeywordWeight {
  readonly token: string
  readonly weight: number
}

interface BilingualRoleLexicon {
  readonly owner: ReadonlyArray<KeywordWeight>
  readonly manager: ReadonlyArray<KeywordWeight>
  readonly employee: ReadonlyArray<KeywordWeight>
}

/**
 * Swahili lexicon — sourced from real-world ASM vocabulary (mwenye = owner,
 * meneja/msimamizi = manager, mfanyakazi/mchimba = field worker). Weights
 * favour role-defining titles over generic verbs.
 */
const SW_LEXICON: BilingualRoleLexicon = {
  owner: [
    { token: 'mwenye', weight: 3 },
    { token: 'mmiliki', weight: 3 },
    { token: 'boss', weight: 2 },
    { token: 'tajiri', weight: 2 },
    { token: 'mwekezaji', weight: 2 },
    { token: 'mkurugenzi', weight: 2 },
    { token: 'pml', weight: 2 },
    { token: 'leseni', weight: 1 }
  ],
  manager: [
    { token: 'meneja', weight: 3 },
    { token: 'msimamizi', weight: 3 },
    { token: 'foreman', weight: 3 },
    { token: 'kiongozi', weight: 2 },
    { token: 'mratibu', weight: 2 },
    { token: 'shift-leader', weight: 2 },
    { token: 'msaidizi-mkuu', weight: 2 },
    { token: 'kapteni', weight: 1 }
  ],
  employee: [
    { token: 'mfanyakazi', weight: 3 },
    { token: 'mchimba', weight: 3 },
    { token: 'mchimbaji', weight: 3 },
    { token: 'shifti', weight: 2 },
    { token: 'chimba', weight: 2 },
    { token: 'opareta', weight: 2 },
    { token: 'dereva', weight: 2 },
    { token: 'mfua', weight: 2 },
    { token: 'mtumishi', weight: 1 }
  ]
}

/**
 * English lexicon — covers expat managers and English-speaking owners.
 */
const EN_LEXICON: BilingualRoleLexicon = {
  owner: [
    { token: 'owner', weight: 3 },
    { token: 'proprietor', weight: 3 },
    { token: 'investor', weight: 2 },
    { token: 'director', weight: 2 },
    { token: 'founder', weight: 2 },
    { token: 'ceo', weight: 2 },
    { token: 'licensee', weight: 2 },
    { token: 'principal', weight: 1 }
  ],
  manager: [
    { token: 'manager', weight: 3 },
    { token: 'supervisor', weight: 3 },
    { token: 'foreman', weight: 3 },
    { token: 'coordinator', weight: 2 },
    { token: 'lead', weight: 2 },
    { token: 'shift-lead', weight: 2 },
    { token: 'superintendent', weight: 2 },
    { token: 'captain', weight: 1 }
  ],
  employee: [
    { token: 'worker', weight: 3 },
    { token: 'miner', weight: 3 },
    { token: 'operator', weight: 3 },
    { token: 'driver', weight: 2 },
    { token: 'labourer', weight: 2 },
    { token: 'laborer', weight: 2 },
    { token: 'crew', weight: 2 },
    { token: 'digger', weight: 2 },
    { token: 'hand', weight: 1 }
  ]
}

function lexiconFor(lang: Lang): BilingualRoleLexicon {
  return lang === 'sw' ? SW_LEXICON : EN_LEXICON
}

function tokenise(input: string): ReadonlyArray<string> {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-￿\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

interface RoleScore {
  readonly role: Role
  readonly score: number
  readonly matched: ReadonlyArray<string>
}

function scoreRoleWithLexicon(
  tokens: ReadonlyArray<string>,
  role: Role,
  weights: ReadonlyArray<KeywordWeight>
): RoleScore {
  const tokenSet = new Set(tokens)
  const matchedEntries = weights.filter((entry) => tokenSet.has(entry.token))
  const score = matchedEntries.reduce((sum, entry) => sum + entry.weight, 0)
  return {
    role,
    score,
    matched: matchedEntries.map((entry) => entry.token)
  }
}

/**
 * Classify a free-text job description into a Borjie role. Tie-breaker is
 * employee (the largest workforce population). Confidence is the winning
 * score divided by the sum of all role scores, clamped to [0, 1].
 *
 * Future swap-in point: `@borjie/brain-llm-router` will implement this same
 * signature, returning `matchedKeywords` as evidence_ids from LMBM citations.
 */
export function classifyRole(utterance: string, lang: Lang): RoleClassification {
  if (typeof utterance !== 'string' || utterance.trim().length === 0) {
    return { role: 'employee', confidence: 0, matchedKeywords: [] }
  }

  const tokens = tokenise(utterance)
  const lex = lexiconFor(lang)

  const scores: ReadonlyArray<RoleScore> = [
    scoreRoleWithLexicon(tokens, 'owner', lex.owner),
    scoreRoleWithLexicon(tokens, 'manager', lex.manager),
    scoreRoleWithLexicon(tokens, 'employee', lex.employee)
  ]

  const total = scores.reduce((sum, entry) => sum + entry.score, 0)
  if (total === 0) {
    return { role: 'employee', confidence: 0, matchedKeywords: [] }
  }

  const ranked = [...scores].sort((a, b) => b.score - a.score)
  const winner = ranked[0]
  const runnerUp = ranked[1]
  if (!winner) {
    return { role: 'employee', confidence: 0, matchedKeywords: [] }
  }

  // Tie -> employee fallback
  if (runnerUp && winner.score === runnerUp.score) {
    const employeeTie = scores.find((entry) => entry.role === 'employee')
    if (employeeTie && employeeTie.score === winner.score) {
      return {
        role: 'employee',
        confidence: clamp01(employeeTie.score / total),
        matchedKeywords: employeeTie.matched
      }
    }
  }

  return {
    role: winner.role,
    confidence: clamp01(winner.score / total),
    matchedKeywords: winner.matched
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Suggest certifications for a free-text role hint. Returns a stable,
 * deduplicated readonly tuple drawn from the canonical `CERTIFICATIONS`
 * list. The mining-shift-planner package consumes the same enum for OSHA-TZ
 * constraint evaluation, so anything captured here becomes a real constraint
 * on the worker's shift plan downstream.
 */
export function recommendCertifications(
  roleHint: string,
  lang: Lang
): ReadonlyArray<Certification> {
  const tokens = tokenise(roleHint)
  const tokenSet = new Set(tokens)
  const triggers = lang === 'sw' ? SW_CERT_TRIGGERS : EN_CERT_TRIGGERS

  const matched: Certification[] = []
  for (const trigger of triggers) {
    if (tokenSet.has(trigger.token) && !matched.includes(trigger.certification)) {
      matched.push(trigger.certification)
    }
  }

  if (matched.length === 0) {
    return Object.freeze(['first-aid'] as const)
  }

  if (!matched.includes('first-aid')) {
    matched.push('first-aid')
  }
  return Object.freeze([...matched])
}

interface CertTrigger {
  readonly token: string
  readonly certification: Certification
}

const SW_CERT_TRIGGERS: ReadonlyArray<CertTrigger> = [
  { token: 'excavator', certification: 'excavator-license' },
  { token: 'opareta', certification: 'excavator-license' },
  { token: 'lori', certification: 'haul-truck-license' },
  { token: 'truck', certification: 'haul-truck-license' },
  { token: 'haul', certification: 'haul-truck-license' },
  { token: 'dereva', certification: 'haul-truck-license' },
  { token: 'chini', certification: 'underground-cert' },
  { token: 'underground', certification: 'underground-cert' },
  { token: 'shimo', certification: 'underground-cert' },
  { token: 'milipuko', certification: 'blaster-permit' },
  { token: 'baruti', certification: 'blaster-permit' },
  { token: 'mlipuaji', certification: 'blaster-permit' },
  { token: 'crusher', certification: 'crusher-operator' },
  { token: 'kuvunja', certification: 'crusher-operator' },
  { token: 'umeme', certification: 'electrician-class-b' },
  { token: 'fundi-umeme', certification: 'electrician-class-b' },
  { token: 'mfungwa', certification: 'confined-space' },
  { token: 'tanki', certification: 'confined-space' }
]

const EN_CERT_TRIGGERS: ReadonlyArray<CertTrigger> = [
  { token: 'excavator', certification: 'excavator-license' },
  { token: 'digger', certification: 'excavator-license' },
  { token: 'operator', certification: 'excavator-license' },
  { token: 'haul', certification: 'haul-truck-license' },
  { token: 'truck', certification: 'haul-truck-license' },
  { token: 'driver', certification: 'haul-truck-license' },
  { token: 'underground', certification: 'underground-cert' },
  { token: 'shaft', certification: 'underground-cert' },
  { token: 'blaster', certification: 'blaster-permit' },
  { token: 'blasting', certification: 'blaster-permit' },
  { token: 'explosives', certification: 'blaster-permit' },
  { token: 'crusher', certification: 'crusher-operator' },
  { token: 'electrician', certification: 'electrician-class-b' },
  { token: 'electrical', certification: 'electrician-class-b' },
  { token: 'confined', certification: 'confined-space' },
  { token: 'tank', certification: 'confined-space' }
]

/**
 * Map three independent sliders (0..1 each) to a single deterministic AI
 * tone. Brevity dominates because field workers prefer concise replies;
 * humour overrides only when explicitly high and formality stays low.
 *
 * Future swap-in: `persona-runtime` consumes `tone` as a memory-namespace
 * param when binding the persona at the end of the wizard.
 */
export function calibrateAiTone(answers: {
  formality: number
  brevity: number
  humor: number
}): AiTone {
  const formality = clamp01(answers.formality)
  const brevity = clamp01(answers.brevity)
  const humor = clamp01(answers.humor)

  if (brevity >= 0.7) {
    return 'brief'
  }
  if (humor >= 0.7 && formality <= 0.4) {
    return 'with-jokes'
  }
  if (formality >= 0.7) {
    return 'formal'
  }
  return 'friendly'
}

export const INTELLIGENCE_VERSION = '1.0.0-deterministic'
