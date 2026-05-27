import type { LanguageCode } from '@/types/auth'

// Buyer persona greeting. Bilingual sw/en — Swahili is the default per
// project hard rule. Chips offer high-intent buyer queries that map
// cleanly onto the tool registry (marketplace.recommended, market data,
// bids.active).

export interface ChatSuggestion {
  readonly id: string
  readonly prompt: string
  readonly label: string
}

const GREETINGS: Readonly<Record<LanguageCode, string>> = {
  sw: 'Karibu, Mnunuzi. Niambie unataka kununua nini leo.',
  en: 'Welcome, buyer. Tell me what you would like to source today.'
}

const SUGGESTIONS_SW: readonly ChatSuggestion[] = [
  { id: 'gold-live', prompt: 'Dhahabu inayouzwa sasa', label: 'Dhahabu inayouzwa sasa' },
  { id: 'tanzanite-price', prompt: 'Bei ya tanzanite leo', label: 'Bei ya tanzanite leo' },
  { id: 'pending-bids', prompt: 'Maombi yangu yanayosubiri', label: 'Maombi yangu yanayosubiri' }
]

const SUGGESTIONS_EN: readonly ChatSuggestion[] = [
  { id: 'gold-live', prompt: 'Gold parcels available now', label: 'Gold parcels available now' },
  { id: 'tanzanite-price', prompt: 'Tanzanite price today', label: 'Tanzanite price today' },
  { id: 'pending-bids', prompt: 'My pending bids', label: 'My pending bids' }
]

export function buyerGreeting(lang: LanguageCode): string {
  return GREETINGS[lang] ?? GREETINGS.sw
}

export function buyerSuggestions(lang: LanguageCode): readonly ChatSuggestion[] {
  return lang === 'en' ? SUGGESTIONS_EN : SUGGESTIONS_SW
}

const LOADING_LABELS: Readonly<Record<LanguageCode, string>> = {
  sw: 'Borjie anafikiri…',
  en: 'Borjie is thinking…'
}

export function loadingLabel(lang: LanguageCode): string {
  return LOADING_LABELS[lang] ?? LOADING_LABELS.sw
}

const ERROR_LABELS: Readonly<Record<LanguageCode, string>> = {
  sw: 'Imeshindwa kuwasiliana na Borjie. Jaribu tena.',
  en: 'Could not reach Borjie. Please retry.'
}

export function errorLabel(lang: LanguageCode): string {
  return ERROR_LABELS[lang] ?? ERROR_LABELS.sw
}

const COMPOSER_PLACEHOLDER: Readonly<Record<LanguageCode, string>> = {
  sw: 'Andika ujumbe kwa Borjie...',
  en: 'Message Borjie...'
}

export function composerPlaceholder(lang: LanguageCode): string {
  return COMPOSER_PLACEHOLDER[lang] ?? COMPOSER_PLACEHOLDER.sw
}
