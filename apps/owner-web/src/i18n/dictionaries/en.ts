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
  },

  signup: {
    page: {
      eyebrow: 'Owner Cockpit',
      heading: 'Welcome to Borjie.',
      subheading: 'Sign up to start managing your mining operation.',
      title: 'Sign up',
    },
    wizard: {
      stepsAriaLabel: 'Signup steps',
      stepKind: 'Type',
      stepDetails: 'Details',
      stepConfirm: 'Confirm',
    },
    kind: {
      question: 'How would you like to sign up?',
      individualTitle: "I'm an individual miner",
      individualSubtitle: 'Artisanal miner or single-PML holder.',
      individualBullet1: 'Full name and phone',
      individualBullet2: 'Email',
      individualBullet3: 'Licence number (PML) — optional',
      individualBullet4: 'NIDA national ID — optional',
      businessTitle: 'I have a registered company',
      businessSubtitle: 'BRELA-registered company or PL/ML holder.',
      businessBullet1: 'Company name + BRELA number',
      businessBullet2: 'TIN number',
      businessBullet3: "Owner's name, phone, and email",
      businessBullet4: 'Licence number (PML/PL/ML) — optional',
    },
    individual: {
      heading: 'Your personal details',
    },
    business: {
      heading: 'Your company details',
    },
    field: {
      fullName: 'Full name',
      country: 'Country',
      phone: 'Phone',
      email: 'Email',
      language: 'Language',
      currency: 'Currency',
      miningLicence: 'Mining licence (PML)',
      miningLicenceBusiness: 'Mining licence (PML/PL/ML)',
      nationalId: 'NIDA national ID',
      orgName: 'Company name',
      businessReg: 'BRELA number',
      taxId: 'TIN number',
      ownerName: "Owner's name",
      ownerPhone: "Owner's phone",
      ownerEmail: "Owner's email",
      vat: 'VAT number',
      optional: '(optional)',
    },
    validation: {
      fullNameRequired: 'Full name is required',
      orgNameRequired: 'Company name is required',
      brelaRequired: 'BRELA number is required',
      tinRequired: 'TIN number is required',
      ownerNameRequired: "Owner's name is required",
      phoneInvalid: 'Enter a valid phone (e.g. +255712345678)',
      emailInvalid: 'Enter a valid email address',
    },
    nav: {
      back: '‹ Back',
      next: 'Continue ›',
      continue: 'Continue',
    },
    contact: {
      heading: 'Confirm and verify',
      labelType: 'Type',
      labelSummary: 'Summary',
      labelOwner: 'Owner',
      labelPhone: 'Phone',
      labelEmail: 'Email',
      sendOtp: 'Send OTP to my phone',
      submitting: 'Sending…',
      otpLabel: 'OTP sent to {phone}',
      verify: 'Verify',
      verifying: 'Verifying…',
      tryAgain: 'Try again',
      errorSignupFailed: 'Sign-up failed',
      errorBadResponse: 'Invalid response from server',
      errorNetwork: 'Could not reach the server',
      errorOtpInvalid: 'Enter a valid OTP code',
      errorOtpVerify: 'Could not verify OTP',
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
