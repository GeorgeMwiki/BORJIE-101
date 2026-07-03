import { getMessages } from '@/lib/i18n';

/**
 * Stable gateway error codes for `/api/v1/orgs/signup`, plus an `unknown`
 * sentinel for any code we do not localize. These are provider-agnostic
 * CODES (never the raw English `json.message` / `json.issues[].message`)
 * so the owner sign-up form can resolve SINGLE-LOCALE copy under the
 * active locale — rendering a raw gateway string under `sw` would be
 * language mixing (the active-locale canon forbids it).
 */
export type SignUpErrorCode =
  | 'email_already_registered'
  | 'phone_already_registered'
  | 'country_not_available'
  | 'auth_provider_unavailable'
  | 'invalid_body'
  | 'unknown';

const SIGN_UP_ERROR_CODES: ReadonlySet<string> = new Set<SignUpErrorCode>([
  'email_already_registered',
  'phone_already_registered',
  'country_not_available',
  'auth_provider_unavailable',
  'invalid_body',
  'unknown',
]);

export function isSignUpErrorCode(value: unknown): value is SignUpErrorCode {
  return typeof value === 'string' && SIGN_UP_ERROR_CODES.has(value);
}

type SignUpErrorMessages =
  ReturnType<typeof getMessages>['ownerSignUpPage']['errors'];

/**
 * Resolve a gateway error CODE to localized copy in the active locale.
 * An unknown code falls back to the localized generic error — never a
 * raw provider string.
 */
export function messageForCode(
  code: SignUpErrorCode,
  errors: SignUpErrorMessages,
): string {
  switch (code) {
    case 'email_already_registered':
      return errors.emailAlreadyRegistered;
    case 'phone_already_registered':
      return errors.phoneAlreadyRegistered;
    case 'country_not_available':
      return errors.countryNotAvailable;
    case 'auth_provider_unavailable':
      return errors.authProviderUnavailable;
    case 'invalid_body':
      return errors.invalidBody;
    default:
      return errors.signUpFailed;
  }
}
