/**
 * WebAuthnClockIn — owner-web kiosk clock-in widget.
 *
 * Mounted in the owner-web /workforce-tabs surface as the on-site
 * kiosk used when a supervisor clocks a crew in/out from the laptop
 * (no mobile required). Calls `navigator.credentials.get()` with
 * `publicKey` against a platform authenticator (Touch ID / Windows
 * Hello), then POSTs to /api/v1/workforce/clock-in.
 *
 * The same backend is shared with:
 *   - workforce-mobile/src/biometric/clockIn.ts (expo-local-auth)
 *   - the chat brain tool `workforce.clock_in_query`
 *
 * (Chat-as-OS bidirectional parity manifesto, principle 4.)
 */

'use client';

import { useState } from 'react';
import { getCsrfHeaders } from '@/lib/csrf';
import { captureError } from '@/lib/sentry';
import {
  pickByLocale,
  readLocaleFromDocument,
  type Locale,
} from '@/lib/locale-shared';
import { webAuthnClockInStrings as S } from '@/i18n/strings/webauthn-clock-in';

export interface WebAuthnClockInProps {
  readonly employeeId: string;
  readonly siteId: string;
  readonly onClockedIn?: (eventId: string) => void;
  /**
   * Active locale. Optional — when omitted the widget reads the document
   * locale so the kiosk chrome is NEVER blind to the user's language (it
   * used to hardcode every English label). A host that already resolved
   * the locale should thread it for SSR/first-paint agreement.
   */
  readonly locale?: Locale;
  /** Override for tests — production calls navigator.credentials.get. */
  readonly authenticate?: () => Promise<{ success: boolean }>;
  /** Override for tests — production calls fetch(). */
  readonly httpPost?: (
    path: string,
    body: Record<string, unknown>,
  ) => Promise<{ data: Record<string, unknown> }>;
}

async function defaultAuthenticate(): Promise<{ success: boolean }> {
  if (
    typeof window === 'undefined' ||
    !window.navigator?.credentials ||
    !window.PublicKeyCredential
  ) {
    return { success: false };
  }
  const challenge = window.crypto.getRandomValues(new Uint8Array(32));
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge,
        userVerification: 'required',
        timeout: 30_000,
      },
    });
    return { success: Boolean(credential) };
  } catch {
    return { success: false };
  }
}

async function defaultHttpPost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`clock-in failed: ${res.status}`);
  }
  const json = (await res.json()) as { data: Record<string, unknown> };
  return json;
}

export function WebAuthnClockIn({
  employeeId,
  siteId,
  onClockedIn,
  locale,
  authenticate,
  httpPost,
}: WebAuthnClockInProps): JSX.Element {
  const activeLocale: Locale = locale ?? readLocaleFromDocument();
  const [status, setStatus] = useState<
    'idle' | 'authenticating' | 'posting' | 'success' | 'error'
  >('idle');
  // Which localised error to render — the biometric check FAILED (no longer
  // swallowed) vs the clock-in POST failed.
  const [errorKind, setErrorKind] = useState<'biometric' | 'record' | null>(
    null,
  );

  async function handleClick(): Promise<void> {
    setErrorKind(null);
    setStatus('authenticating');
    const authFn = authenticate ?? defaultAuthenticate;
    const auth = await authFn();
    // Surface the previously-swallowed biometric failure as a distinct,
    // localised state — never silently POST a failed check.
    if (!auth.success) {
      setStatus('error');
      setErrorKind('biometric');
      return;
    }
    setStatus('posting');
    try {
      const post = httpPost ?? defaultHttpPost;
      const response = await post('/api/v1/workforce/clock-in', {
        employeeId,
        siteId,
        biometricProvider: 'webauthn_platform',
        biometricPassed: auth.success,
      });
      const eventId = String(response.data.id ?? '');
      setStatus('success');
      onClockedIn?.(eventId);
    } catch (err) {
      // Map the raw fetch / SDK error to a LOCALISED message — the detail
      // goes to the trace sink, never into the kiosk chrome.
      captureError(err, {
        route: '/api/v1/workforce/clock-in',
        extra: { siteId },
      });
      setStatus('error');
      setErrorKind('record');
    }
  }

  const buttonLabel =
    status === 'authenticating'
      ? pickByLocale(activeLocale, S.authenticating)
      : status === 'posting'
        ? pickByLocale(activeLocale, S.recording)
        : status === 'success'
          ? pickByLocale(activeLocale, S.clockedIn)
          : status === 'error'
            ? pickByLocale(activeLocale, S.retry)
            : pickByLocale(activeLocale, S.clockIn);

  const errorMessage =
    errorKind === 'biometric'
      ? pickByLocale(activeLocale, S.biometricFailed)
      : errorKind === 'record'
        ? pickByLocale(activeLocale, S.recordError)
        : null;

  return (
    <div className="webauthn-clock-in">
      <button
        type="button"
        onClick={() => {
          void handleClick();
        }}
        disabled={status === 'authenticating' || status === 'posting'}
        className="rounded-md border px-4 py-2 text-sm"
      >
        {buttonLabel}
      </button>
      {errorMessage ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
