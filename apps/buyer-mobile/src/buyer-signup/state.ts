/**
 * Buyer signup wizard state machine.
 *
 * AsyncStorage-backed React Context so a resumed app session returns the
 * buyer to the screen they left, with every field they had filled. The
 * machine is intentionally immutable — every transition returns a new
 * state object via the spread operator. No callsite mutates state.
 *
 * Persistence layout:
 *
 *   AsyncStorage["borjie.buyer_signup.v1"] = JSON.stringify(state)
 *
 *   The version suffix lets us bump the schema without colliding with
 *   in-progress signups in older builds (we just discard them).
 *
 * Why not a reducer / Redux? The flow is tiny (≤ 7 atoms) and the
 * Context API + setState is enough; pulling Redux into a mobile bundle
 * is dead-weight here.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import type { BuyerAccountKind, BuyerKycAtomKey } from './kyc-atoms'

// ─── Wire types ──────────────────────────────────────────────────────

export type BuyerCountry =
  | 'TZ'
  | 'KE'
  | 'UG'
  | 'NG'
  | 'CN'
  | 'IN'
  | 'AE'
  | 'EU'
  | 'OTHER'

export type BuyerCurrency = 'USD' | 'TZS' | 'KES' | 'EUR' | 'CNY' | 'INR'

export type BuyerLanguage = 'sw' | 'en'

export type BuyerBusinessKind =
  | 'refiner'
  | 'broker'
  | 'fabricator'
  | 'investor'
  | 'other'

export interface IndividualFields {
  readonly fullName: string
  readonly phoneE164: string
  readonly email: string
  readonly nationalIdNumber: string
}

export interface BusinessFields {
  readonly orgName: string
  readonly businessKind: BuyerBusinessKind
  readonly businessRegistrationNumber: string
  readonly taxId: string
  readonly contactFullName: string
  readonly contactPhoneE164: string
  readonly contactEmail: string
}

export interface BuyerSignupState {
  /** Set once the user picks INDIVIDUAL or BUSINESS in the kind picker. */
  readonly kind: BuyerAccountKind | null
  readonly country: BuyerCountry
  readonly preferredCurrency: BuyerCurrency
  readonly preferredLanguage: BuyerLanguage
  readonly individual: IndividualFields
  readonly business: BusinessFields
  /** Server response fields persisted after POST /signup succeeds. */
  readonly buyerOrgId: string | null
  readonly tenantId: string | null
  readonly userId: string | null
  readonly otpVerified: boolean
  /** Atom keys the user has completed. */
  readonly kycAtomsCompleted: ReadonlyArray<BuyerKycAtomKey>
}

export const STORAGE_KEY = 'borjie.buyer_signup.v1'

export const initialBuyerSignupState: BuyerSignupState = {
  kind: null,
  country: 'TZ',
  preferredCurrency: 'USD',
  preferredLanguage: 'sw',
  individual: {
    fullName: '',
    phoneE164: '',
    email: '',
    nationalIdNumber: ''
  },
  business: {
    orgName: '',
    businessKind: 'refiner',
    businessRegistrationNumber: '',
    taxId: '',
    contactFullName: '',
    contactPhoneE164: '',
    contactEmail: ''
  },
  buyerOrgId: null,
  tenantId: null,
  userId: null,
  otpVerified: false,
  kycAtomsCompleted: []
}

// ─── Context ─────────────────────────────────────────────────────────

export interface BuyerSignupContextValue {
  readonly state: BuyerSignupState
  readonly hydrated: boolean
  readonly setKind: (kind: BuyerAccountKind) => void
  readonly setLocale: (
    country: BuyerCountry,
    currency: BuyerCurrency,
    language: BuyerLanguage
  ) => void
  readonly setIndividual: (fields: Partial<IndividualFields>) => void
  readonly setBusiness: (fields: Partial<BusinessFields>) => void
  readonly setServerResult: (result: {
    readonly buyerOrgId: string
    readonly tenantId: string
    readonly userId: string
  }) => void
  readonly markOtpVerified: () => void
  readonly markAtomCompleted: (atom: BuyerKycAtomKey) => void
  readonly reset: () => Promise<void>
}

const BuyerSignupContext = createContext<BuyerSignupContextValue | null>(null)

// ─── Persistence helpers ─────────────────────────────────────────────

async function loadState(): Promise<BuyerSignupState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return initialBuyerSignupState
    }
    const parsed = JSON.parse(raw) as Partial<BuyerSignupState>
    return {
      ...initialBuyerSignupState,
      ...parsed,
      individual: {
        ...initialBuyerSignupState.individual,
        ...(parsed.individual ?? {})
      },
      business: {
        ...initialBuyerSignupState.business,
        ...(parsed.business ?? {})
      },
      kycAtomsCompleted: parsed.kycAtomsCompleted ?? []
    }
  } catch {
    return initialBuyerSignupState
  }
}

async function persistState(state: BuyerSignupState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Persistence is best-effort; the in-memory state is the source of truth.
  }
}

// ─── Provider ────────────────────────────────────────────────────────

export interface BuyerSignupProviderProps {
  readonly children: ReactNode
}

export function BuyerSignupProvider({
  children
}: BuyerSignupProviderProps): JSX.Element {
  const [state, setState] = useState<BuyerSignupState>(initialBuyerSignupState)
  const [hydrated, setHydrated] = useState<boolean>(false)

  useEffect(() => {
    let mounted = true
    void loadState().then((next) => {
      if (mounted) {
        setState(next)
        setHydrated(true)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!hydrated) {
      return
    }
    void persistState(state)
  }, [hydrated, state])

  const setKind = useCallback((kind: BuyerAccountKind) => {
    setState((prev) => ({ ...prev, kind }))
  }, [])

  const setLocale = useCallback(
    (
      country: BuyerCountry,
      currency: BuyerCurrency,
      language: BuyerLanguage
    ) => {
      setState((prev) => ({
        ...prev,
        country,
        preferredCurrency: currency,
        preferredLanguage: language
      }))
    },
    []
  )

  const setIndividual = useCallback((fields: Partial<IndividualFields>) => {
    setState((prev) => ({
      ...prev,
      individual: { ...prev.individual, ...fields }
    }))
  }, [])

  const setBusiness = useCallback((fields: Partial<BusinessFields>) => {
    setState((prev) => ({
      ...prev,
      business: { ...prev.business, ...fields }
    }))
  }, [])

  const setServerResult = useCallback(
    (result: { buyerOrgId: string; tenantId: string; userId: string }) => {
      setState((prev) => ({
        ...prev,
        buyerOrgId: result.buyerOrgId,
        tenantId: result.tenantId,
        userId: result.userId
      }))
    },
    []
  )

  const markOtpVerified = useCallback(() => {
    setState((prev) => ({ ...prev, otpVerified: true }))
  }, [])

  const markAtomCompleted = useCallback((atom: BuyerKycAtomKey) => {
    setState((prev) => {
      if (prev.kycAtomsCompleted.includes(atom)) {
        return prev
      }
      return {
        ...prev,
        kycAtomsCompleted: [...prev.kycAtomsCompleted, atom]
      }
    })
  }, [])

  const reset = useCallback(async () => {
    setState(initialBuyerSignupState)
    try {
      await AsyncStorage.removeItem(STORAGE_KEY)
    } catch {
      // Best-effort
    }
  }, [])

  const value = useMemo<BuyerSignupContextValue>(
    () => ({
      state,
      hydrated,
      setKind,
      setLocale,
      setIndividual,
      setBusiness,
      setServerResult,
      markOtpVerified,
      markAtomCompleted,
      reset
    }),
    [
      state,
      hydrated,
      setKind,
      setLocale,
      setIndividual,
      setBusiness,
      setServerResult,
      markOtpVerified,
      markAtomCompleted,
      reset
    ]
  )

  return createElement(BuyerSignupContext.Provider, { value }, children)
}

export function useBuyerSignup(): BuyerSignupContextValue {
  const ctx = useContext(BuyerSignupContext)
  if (!ctx) {
    throw new Error(
      'useBuyerSignup must be used inside <BuyerSignupProvider>'
    )
  }
  return ctx
}

// ─── Pure helpers (no hooks) ─────────────────────────────────────────

/**
 * Build the API request body from the current wizard state. Returns
 * `null` if the state isn't ready (no kind chosen) so the caller can
 * route the user back to the kind picker.
 */
export function buildSignupBody(
  state: BuyerSignupState
):
  | { readonly kind: 'individual'; readonly body: Record<string, unknown> }
  | { readonly kind: 'business'; readonly body: Record<string, unknown> }
  | null {
  if (state.kind === 'individual') {
    const body: Record<string, unknown> = {
      kind: 'individual',
      country: state.country,
      fullName: state.individual.fullName,
      phoneE164: state.individual.phoneE164,
      email: state.individual.email,
      preferredCurrency: state.preferredCurrency,
      preferredLanguage: state.preferredLanguage
    }
    if (state.individual.nationalIdNumber.length > 0) {
      body.nationalIdNumber = state.individual.nationalIdNumber
    }
    return { kind: 'individual', body }
  }
  if (state.kind === 'business') {
    return {
      kind: 'business',
      body: {
        kind: 'business',
        country: state.country,
        orgName: state.business.orgName,
        businessKind: state.business.businessKind,
        businessRegistrationNumber: state.business.businessRegistrationNumber,
        taxId: state.business.taxId,
        contactFullName: state.business.contactFullName,
        contactPhoneE164: state.business.contactPhoneE164,
        contactEmail: state.business.contactEmail,
        preferredCurrency: state.preferredCurrency,
        preferredLanguage: state.preferredLanguage
      }
    }
  }
  return null
}

/** Re-export for callers that only need the storage key (tests). */
export const BUYER_SIGNUP_STORAGE_KEY = STORAGE_KEY
