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

export interface WebAuthnClockInProps {
  readonly employeeId: string;
  readonly siteId: string;
  readonly onClockedIn?: (eventId: string) => void;
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
    headers: { 'content-type': 'application/json' },
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
  authenticate,
  httpPost,
}: WebAuthnClockInProps): JSX.Element {
  const [status, setStatus] = useState<
    'idle' | 'authenticating' | 'posting' | 'success' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setErrorMessage(null);
    setStatus('authenticating');
    const authFn = authenticate ?? defaultAuthenticate;
    const auth = await authFn();
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
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const buttonLabel =
    status === 'authenticating'
      ? 'Authenticating...'
      : status === 'posting'
        ? 'Recording...'
        : status === 'success'
          ? 'Clocked in'
          : status === 'error'
            ? 'Retry clock-in'
            : 'Clock in (WebAuthn)';

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
