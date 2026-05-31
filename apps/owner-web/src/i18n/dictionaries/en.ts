/**
 * English source-of-truth dictionary for the owner cockpit.
 *
 * This is the ONLY file a human edits. The Swahili mirror (`sw.ts`) is
 * GENERATED from these strings by `scripts/i18n-generate-sw.mjs`
 * (Claude tier-1 via `@borjie/translation`, content-addressed in
 * `translation_cache`). Never hand-edit `sw.ts`.
 *
 * Rules for adding keys:
 *  - Group by surface namespace (`auth.signIn.*`, `dashboard.*`, …).
 *  - English only here — no Swahili, ever (the locale-purity guard
 *    fails the build if Swahili leaks into this file).
 *  - Use `{var}` placeholders for interpolation, never string concat.
 *  - A new key is dead until `pnpm i18n:gen` regenerates `sw.ts`.
 */

export const en = {
  common: {
    appName: 'Borjie',
    loading: 'Loading…',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    continue: 'Continue',
    submit: 'Submit',
    error: 'Something went wrong.',
  },

  auth: {
    signIn: {
      eyebrow: 'Owner Cockpit',
      heading: 'Welcome back.',
      subheading: 'Sign in to continue to your cockpit.',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      submit: 'Sign in',
      submitting: 'Signing in…',
      footer: 'Audit chain · bilingual · Tanzania-resident',
      errorInvalidEmail: 'Enter a valid email address',
      errorPasswordRequired: 'Password is required',
      errorInvalidInput: 'Invalid details',
      errorSignInFailed: 'Sign-in failed. Check your details.',
      errorNetwork: 'Could not reach the Borjie API.',
    },
    signUp: {
      eyebrow: 'Owner Cockpit',
      heading: 'Create your estate',
      subheading: 'Bring your mining estate onto Borjie.',
      kindQuestion: 'Who is registering?',
      kindIndividual: 'Individual owner',
      kindIndividualHint: 'A single licence holder or artisanal operator.',
      kindBusiness: 'Registered business',
      kindBusinessHint: 'A company, cooperative, or registered entity.',
      contactHeading: 'Your contact details',
      fullNameLabel: 'Full name',
      emailLabel: 'Email',
      phoneLabel: 'Phone number',
      businessNameLabel: 'Business name',
      registrationNumberLabel: 'Registration number',
      submit: 'Create estate',
      submitting: 'Creating…',
      errorRequired: 'This field is required',
      errorInvalidEmail: 'Enter a valid email address',
    },
  },

  dashboard: {
    greetingMorning: 'Good morning, {name}',
    greetingAfternoon: 'Good afternoon, {name}',
    greetingEvening: 'Good evening, {name}',
    subtitle: 'Here is your estate at a glance.',
    emptyState: 'Nothing to show yet.',
  },

  nav: {
    dashboard: 'Dashboard',
    cockpit: 'Cockpit',
    finance: 'Finance',
    treasury: 'Treasury',
    workforce: 'Workforce',
    compliance: 'Compliance',
    marketplace: 'Marketplace',
    settings: 'Settings',
    notifications: 'Notifications',
  },
} as const;

export type Dictionary = typeof en;
