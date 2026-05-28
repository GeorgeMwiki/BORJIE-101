/**
 * clockIn — workforce-mobile biometric clock-in wrapper.
 *
 * Wraps `expo-local-authentication` + the existing `useFingerprintSign`
 * hook into a single call site for the workforce mobile clock-in flow.
 * Posts to `/api/v1/workforce/clock-in` on the api-gateway and returns
 * the persisted event row.
 *
 * Both the explicit "Clock In" button and the in-app chat ("Mr. Mwikila,
 * clock me in now") hit this same helper so the backend sees one
 * surface (Chat-as-OS bidirectional parity manifesto, principle 4).
 */

import * as LocalAuthentication from 'expo-local-authentication';

export interface ClockInRequest {
  readonly employeeId: string;
  readonly siteId: string;
  readonly deviceId?: string;
  readonly geo?: { readonly lat: number; readonly lng: number };
}

export interface ClockInResponse {
  readonly id: string;
  readonly clockedInAt: string;
  readonly biometricProvider: string;
  readonly biometricPassed: boolean;
}

export interface ClockInDeps {
  /** Authenticated POST helper. */
  readonly httpPost: (
    path: string,
    body: Record<string, unknown>,
  ) => Promise<{ data: Record<string, unknown> }>;
  /**
   * Optional override for tests — return a deterministic biometric
   * result. Production reads the system biometric stack.
   */
  readonly authenticate?: () => Promise<{
    success: boolean;
    method: 'fingerprint' | 'face' | 'passcode' | 'stub';
  }>;
}

async function defaultAuthenticate(): Promise<{
  success: boolean;
  method: 'fingerprint' | 'face' | 'passcode' | 'stub';
}> {
  const supported = await LocalAuthentication.hasHardwareAsync();
  if (!supported) {
    // Dev/sim fallback so the flow works without a device. The backend
    // sees `biometric_provider=pin_fallback` + `passed=false` and
    // production tenants reject this; audit tenants accept it.
    return { success: false, method: 'stub' };
  }
  const types =
    await LocalAuthentication.supportedAuthenticationTypesAsync();
  const method = types.includes(
    LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
  )
    ? 'face'
    : 'fingerprint';
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Clock in to your shift',
    fallbackLabel: 'Use passcode',
  });
  return { success: result.success, method };
}

function mapMethodToProvider(
  method: 'fingerprint' | 'face' | 'passcode' | 'stub',
): string {
  switch (method) {
    case 'fingerprint':
      return 'touch_id';
    case 'face':
      return 'face_id';
    case 'passcode':
      return 'pin_fallback';
    case 'stub':
      return 'pin_fallback';
  }
}

/**
 * Run the full clock-in flow: trigger biometric prompt, post the event
 * to the api-gateway, return the persisted row. Throws on network /
 * validation errors; biometric failure is forwarded to the backend
 * (which may reject for production tenants).
 */
export async function clockIn(
  req: ClockInRequest,
  deps: ClockInDeps,
): Promise<ClockInResponse> {
  const authFn = deps.authenticate ?? defaultAuthenticate;
  const auth = await authFn();
  const provider = mapMethodToProvider(auth.method);
  const response = await deps.httpPost('/api/v1/workforce/clock-in', {
    employeeId: req.employeeId,
    siteId: req.siteId,
    biometricProvider: provider,
    biometricPassed: auth.success,
    deviceId: req.deviceId,
    geoLat: req.geo?.lat,
    geoLng: req.geo?.lng,
  });
  const row = response.data;
  return {
    id: String(row.id ?? ''),
    clockedInAt: String(row.clocked_in_at ?? new Date().toISOString()),
    biometricProvider: String(row.biometric_provider ?? provider),
    biometricPassed: Boolean(row.biometric_passed ?? auth.success),
  };
}
