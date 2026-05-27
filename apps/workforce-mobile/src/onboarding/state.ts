import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { z } from 'zod'
import type { Lang } from '../auth/types'
import type { Role } from '../roles/types'
import { CERTIFICATIONS, type Certification } from './certifications'

/**
 * Wizard state machine for the worker onboarding flow. Keeps all draft state
 * in-memory (no AsyncStorage, no backend) so the user can abandon and restart
 * without persisting half-collected data. Persona binding and role assignment
 * happen in `done.tsx` via the AuthContext.
 *
 * Architecture note: the schema is intentionally a single flat shape so the
 * future `@borjie/brain-llm-router` consumer can serialise it as a "user
 * memory namespace" payload without re-mapping nested structures.
 */

export const aiToneSchema = z.enum(['formal', 'friendly', 'brief', 'with-jokes'])
export type AiTone = z.infer<typeof aiToneSchema>

export const langSchema = z.enum(['sw', 'en'])
export const roleSchema = z.enum(['owner', 'manager', 'employee'])

export const onboardingStepIdSchema = z.enum([
  'welcome',
  'phone',
  'identity',
  'role-detect',
  'site',
  'certifications',
  'biometric',
  'safety',
  'calibration',
  'done'
])
export type OnboardingStepId = z.infer<typeof onboardingStepIdSchema>

export const ONBOARDING_STEPS: ReadonlyArray<OnboardingStepId> = [
  'welcome',
  'phone',
  'identity',
  'role-detect',
  'site',
  'certifications',
  'biometric',
  'safety',
  'calibration',
  'done'
]

export const onboardingDraftSchema = z.object({
  lang: langSchema.default('sw'),
  phone: z.string().default(''),
  otpCode: z.string().default(''),
  otpVerified: z.boolean().default(false),
  fullName: z.string().default(''),
  dob: z.string().default(''),
  nidaNumber: z.string().default(''),
  role: roleSchema.nullable().default(null),
  roleHint: z.string().default(''),
  roleConfidence: z.number().min(0).max(1).default(0),
  personaSlug: z.string().default(''),
  siteCode: z.string().default(''),
  pmlNumber: z.string().default(''),
  certifications: z.array(z.enum(CERTIFICATIONS)).default([]),
  biometricEnrolled: z.boolean().default(false),
  pinFallback: z.string().default(''),
  safetyAcknowledgedTopics: z.array(z.string()).default([]),
  safetySignedOff: z.boolean().default(false),
  aiTone: aiToneSchema.default('friendly'),
  toneSliders: z
    .object({
      formality: z.number().min(0).max(1),
      brevity: z.number().min(0).max(1),
      humor: z.number().min(0).max(1)
    })
    .default({ formality: 0.5, brevity: 0.5, humor: 0.2 }),
  completedSteps: z.array(onboardingStepIdSchema).default([])
})

export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>

export function emptyOnboardingDraft(initialLang: Lang = 'sw'): OnboardingDraft {
  return onboardingDraftSchema.parse({ lang: initialLang })
}

export interface OnboardingDraftContextValue {
  current: OnboardingDraft
  update: (patch: Partial<OnboardingDraft>) => void
  markStepComplete: (step: OnboardingStepId) => void
  reset: () => void
}

const DEFAULT_CONTEXT: OnboardingDraftContextValue = {
  current: emptyOnboardingDraft(),
  update: () => undefined,
  markStepComplete: () => undefined,
  reset: () => undefined
}

const OnboardingDraftContext = createContext<OnboardingDraftContextValue>(DEFAULT_CONTEXT)

export interface OnboardingDraftProviderProps {
  children: ReactNode
  initialLang?: Lang
}

export function OnboardingDraftProvider({
  children,
  initialLang = 'sw'
}: OnboardingDraftProviderProps): JSX.Element {
  const [current, setCurrent] = useState<OnboardingDraft>(() => emptyOnboardingDraft(initialLang))

  const update = useCallback((patch: Partial<OnboardingDraft>): void => {
    setCurrent((prev) => ({ ...prev, ...patch }))
  }, [])

  const markStepComplete = useCallback((step: OnboardingStepId): void => {
    setCurrent((prev) =>
      prev.completedSteps.includes(step)
        ? prev
        : { ...prev, completedSteps: [...prev.completedSteps, step] }
    )
  }, [])

  const reset = useCallback((): void => {
    setCurrent(emptyOnboardingDraft(initialLang))
  }, [initialLang])

  const value = useMemo<OnboardingDraftContextValue>(
    () => ({ current, update, markStepComplete, reset }),
    [current, update, markStepComplete, reset]
  )

  return createElement(OnboardingDraftContext.Provider, { value }, children)
}

export function useOnboardingDraft(): OnboardingDraftContextValue {
  return useContext(OnboardingDraftContext)
}

export function stepIndex(step: OnboardingStepId): number {
  return ONBOARDING_STEPS.indexOf(step)
}

export function stepLabel(step: OnboardingStepId): string {
  return `${stepIndex(step) + 1} / ${ONBOARDING_STEPS.length}`
}

export type { Certification }
