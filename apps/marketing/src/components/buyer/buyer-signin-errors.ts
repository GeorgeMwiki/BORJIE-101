import { getMessages } from '@/lib/i18n';

/**
 * Provider-agnostic sign-in error CODES for the buyer surface, plus an
 * `unknown` sentinel. These are CODES (never the raw English Supabase
 * `error.message` such as "Invalid login credentials") so the buyer
 * sign-in form can resolve SINGLE-LOCALE copy under the active locale —
 * rendering the raw provider string under `sw` would be language mixing
 * (the active-locale canon forbids it).
 */
export type SignInErrorCode =
  | 'invalid_credentials'
  | 'too_many_attempts'
  | 'unknown';

/**
 * The minimal shape of the Supabase `AuthError` this mapper reads. We do
 * not import the concrete class — the browser client returns a structured
 * error with a numeric HTTP `status` and an optional stable `code`, and
 * that is all we branch on. The raw `message` is deliberately NOT part of
 * this contract: it never reaches user copy.
 */
export interface AuthErrorLike {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/**
 * Classify a Supabase sign-in error into a provider-agnostic CODE by
 * inspecting only its structured `status` / `code` (never the free-text
 * `message`). Invalid credentials and rate-limit are the two cases worth
 * distinguishing for the buyer; everything else collapses to `unknown`,
 * which resolves to the localized generic fallback.
 */
export function classifySignInError(error: AuthErrorLike): SignInErrorCode {
  const code = error.code ?? '';
  const status = error.status ?? 0;

  if (status === 429 || code === 'over_request_rate_limit') {
    return 'too_many_attempts';
  }
  if (
    status === 400 ||
    code === 'invalid_credentials' ||
    code === 'invalid_grant'
  ) {
    return 'invalid_credentials';
  }
  return 'unknown';
}

type SignInErrorMessages =
  ReturnType<typeof getMessages>['buyerSignInPage']['errors'];

/**
 * Resolve a sign-in error CODE to localized copy in the active locale.
 * An unknown code falls back to the localized generic error — never a
 * raw provider string.
 */
export function messageForSignInCode(
  code: SignInErrorCode,
  errors: SignInErrorMessages,
): string {
  switch (code) {
    case 'invalid_credentials':
      return errors.invalidCredentials;
    case 'too_many_attempts':
      return errors.tooManyAttempts;
    default:
      return errors.signInFailed;
  }
}
