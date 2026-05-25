/**
 * WebAuthn / passkey service.
 *
 * Wraps an adapter (real `@simplewebauthn/server` v11+ or a stub) with
 * tenant-isolation guarantees:
 *
 *   - Every credential is tagged with `tenantId` at registration.
 *   - `verifyAuthentication` rejects credentials whose persisted
 *     `tenantId` does not match the active tenant — guards against
 *     cross-tenant credential reuse even if the credential id leaks.
 *
 * The factory takes a `now` clock so tests can pin timestamps.
 */

import type {
  WebAuthnCredential,
  TenantId,
  UserId,
} from '../types.js';
import type { WebAuthnAdapter } from './adapter.js';

export interface WebAuthnServiceOptions {
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
  readonly adapter: WebAuthnAdapter;
  readonly now?: () => number;
}

export interface GenerateRegistrationOptionsInput {
  readonly user: {
    readonly id: UserId;
    readonly tenantId: TenantId;
    readonly username: string;
    readonly displayName: string;
  };
  readonly excludeCredentialIds?: ReadonlyArray<string>;
}

export interface ServiceVerifyRegistrationInput {
  readonly user: {
    readonly id: UserId;
    readonly tenantId: TenantId;
  };
  readonly response: unknown;
  readonly expectedChallenge: string;
}

export interface ServiceVerifyRegistrationOk {
  readonly ok: true;
  readonly credential: WebAuthnCredential;
}

export interface ServiceVerifyErr {
  readonly ok: false;
  readonly reason: string;
}

export type ServiceVerifyRegistrationResult =
  | ServiceVerifyRegistrationOk
  | ServiceVerifyErr;

export interface GenerateAuthOptionsInput {
  readonly user: {
    readonly id: UserId;
    readonly tenantId: TenantId;
  };
  readonly allowCredentials?: ReadonlyArray<{ id: string }>;
}

export interface ServiceVerifyAuthenticationInput {
  readonly user: {
    readonly id: UserId;
    readonly tenantId: TenantId;
  };
  readonly response: unknown;
  readonly expectedChallenge: string;
  readonly credential: WebAuthnCredential;
}

export interface ServiceVerifyAuthenticationOk {
  readonly ok: true;
  readonly credential: WebAuthnCredential;
}

export type ServiceVerifyAuthenticationResult =
  | ServiceVerifyAuthenticationOk
  | ServiceVerifyErr;

export interface WebAuthnService {
  readonly rpId: string;
  readonly rpName: string;
  generateRegistrationOptions(
    input: GenerateRegistrationOptionsInput,
  ): Promise<{
    readonly challenge: string;
    readonly options: Awaited<
      ReturnType<WebAuthnAdapter['generateRegistrationOptions']>
    >;
  }>;
  verifyRegistration(
    input: ServiceVerifyRegistrationInput,
  ): Promise<ServiceVerifyRegistrationResult>;
  generateAuthenticationOptions(
    input: GenerateAuthOptionsInput,
  ): Promise<{
    readonly challenge: string;
    readonly options: Awaited<
      ReturnType<WebAuthnAdapter['generateAuthenticationOptions']>
    >;
  }>;
  verifyAuthentication(
    input: ServiceVerifyAuthenticationInput,
  ): Promise<ServiceVerifyAuthenticationResult>;
}

export function createWebAuthnService(
  opts: WebAuthnServiceOptions,
): WebAuthnService {
  const now = opts.now ?? Date.now;
  const adapter = opts.adapter;

  return {
    rpId: opts.rpId,
    rpName: opts.rpName,

    async generateRegistrationOptions({ user, excludeCredentialIds }) {
      const options = await adapter.generateRegistrationOptions({
        rpName: opts.rpName,
        rpId: opts.rpId,
        userId: user.id,
        userName: user.username,
        userDisplayName: user.displayName,
        ...(excludeCredentialIds
          ? { excludeCredentials: excludeCredentialIds.map((id) => ({ id })) }
          : {}),
        attestationType: 'none',
      });
      return { challenge: options.challenge, options };
    },

    async verifyRegistration({ user, response, expectedChallenge }) {
      const result = await adapter.verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: opts.origin,
        expectedRPID: opts.rpId,
      });

      if (!result.verified || !result.registrationInfo) {
        return { ok: false, reason: 'registration_not_verified' };
      }

      const info = result.registrationInfo;
      const credential: WebAuthnCredential = {
        credentialId: info.credentialID,
        publicKey: info.credentialPublicKey,
        counter: info.counter,
        tenantId: user.tenantId,
        userId: user.id,
        ...(info.aaguid !== undefined ? { aaguid: info.aaguid } : {}),
        ...(info.credentialDeviceType !== undefined
          ? { deviceType: info.credentialDeviceType }
          : {}),
        ...(info.credentialBackedUp !== undefined
          ? { backedUp: info.credentialBackedUp }
          : {}),
        createdAt: now(),
      };
      return { ok: true, credential };
    },

    async generateAuthenticationOptions({ allowCredentials }) {
      const options = await adapter.generateAuthenticationOptions({
        rpId: opts.rpId,
        ...(allowCredentials ? { allowCredentials } : {}),
      });
      return { challenge: options.challenge, options };
    },

    async verifyAuthentication({
      user,
      response,
      expectedChallenge,
      credential,
    }) {
      // Tenant isolation — the credential MUST belong to the active
      // tenant + user. Defends against credential-id reuse across
      // tenants even if the id leaks.
      if (credential.tenantId !== user.tenantId) {
        return { ok: false, reason: 'tenant_mismatch' };
      }
      if (credential.userId !== user.id) {
        return { ok: false, reason: 'user_mismatch' };
      }

      const result = await adapter.verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: opts.origin,
        expectedRPID: opts.rpId,
        authenticator: {
          credentialID: credential.credentialId,
          credentialPublicKey: credential.publicKey,
          counter: credential.counter,
        },
      });

      if (!result.verified || !result.authenticationInfo) {
        return { ok: false, reason: 'authentication_not_verified' };
      }

      const newCounter = result.authenticationInfo.newCounter;
      // Cloned-authenticator detection — counter must strictly increase
      // for single-device credentials.
      if (
        credential.deviceType === 'singleDevice' &&
        newCounter <= credential.counter
      ) {
        return { ok: false, reason: 'counter_not_increasing' };
      }

      const updated: WebAuthnCredential = {
        ...credential,
        counter: newCounter,
        lastUsedAt: now(),
      };
      return { ok: true, credential: updated };
    },
  };
}
