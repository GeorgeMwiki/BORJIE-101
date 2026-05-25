/**
 * WebAuthn adapter port.
 *
 * We do NOT hard-import `@simplewebauthn/server` — it is an OPTIONAL
 * peer dep. The package ships an `adapter` port instead so:
 *
 *   - Tests can inject a deterministic stub (no native crypto needed,
 *     no real authenticator).
 *   - Production wires the real `@simplewebauthn/server` shim — see
 *     `createSimpleWebAuthnAdapter()` below for the integration glue.
 *
 * The port shapes mirror the v11+ `@simplewebauthn/server` API enough
 * that the production glue is a thin pass-through.
 */

export interface RegistrationOptionsInput {
  readonly rpName: string;
  readonly rpId: string;
  readonly userId: string;
  readonly userName: string;
  readonly userDisplayName: string;
  readonly excludeCredentials?: ReadonlyArray<{ id: string }>;
  readonly attestationType?: 'none' | 'direct' | 'indirect';
}

export interface RegistrationOptionsResult {
  readonly challenge: string;
  readonly rp: { readonly id: string; readonly name: string };
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly displayName: string;
  };
  readonly pubKeyCredParams: ReadonlyArray<{
    readonly type: 'public-key';
    readonly alg: number;
  }>;
}

export interface AuthenticationOptionsInput {
  readonly rpId: string;
  readonly allowCredentials?: ReadonlyArray<{ id: string }>;
}

export interface AuthenticationOptionsResult {
  readonly challenge: string;
  readonly rpId: string;
  readonly allowCredentials: ReadonlyArray<{
    readonly id: string;
    readonly type: 'public-key';
  }>;
}

export interface VerifyRegistrationInput {
  readonly response: unknown;
  readonly expectedChallenge: string;
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
}

export interface VerifyRegistrationResult {
  readonly verified: boolean;
  readonly registrationInfo?: {
    readonly credentialID: string;
    readonly credentialPublicKey: string;
    readonly counter: number;
    readonly aaguid?: string;
    readonly credentialDeviceType?: 'singleDevice' | 'multiDevice';
    readonly credentialBackedUp?: boolean;
  };
}

export interface VerifyAuthenticationInput {
  readonly response: unknown;
  readonly expectedChallenge: string;
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
  readonly authenticator: {
    readonly credentialID: string;
    readonly credentialPublicKey: string;
    readonly counter: number;
  };
}

export interface VerifyAuthenticationResult {
  readonly verified: boolean;
  readonly authenticationInfo?: {
    readonly newCounter: number;
  };
}

/**
 * Adapter implemented either by a test stub or by the production
 * `@simplewebauthn/server` shim.
 */
export interface WebAuthnAdapter {
  generateRegistrationOptions(
    input: RegistrationOptionsInput,
  ): Promise<RegistrationOptionsResult>;
  verifyRegistrationResponse(
    input: VerifyRegistrationInput,
  ): Promise<VerifyRegistrationResult>;
  generateAuthenticationOptions(
    input: AuthenticationOptionsInput,
  ): Promise<AuthenticationOptionsResult>;
  verifyAuthenticationResponse(
    input: VerifyAuthenticationInput,
  ): Promise<VerifyAuthenticationResult>;
}

/**
 * Deterministic stub adapter used by tests. Returns predictable
 * challenges/credentials so we can assert behaviour without crypto.
 */
export function createStubAdapter(seed = 'stub'): WebAuthnAdapter {
  let calls = 0;
  const challenge = (): string => `challenge-${seed}-${++calls}`;
  return {
    async generateRegistrationOptions(input) {
      return {
        challenge: challenge(),
        rp: { id: input.rpId, name: input.rpName },
        user: {
          id: input.userId,
          name: input.userName,
          displayName: input.userDisplayName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
      };
    },
    async verifyRegistrationResponse(input) {
      const response = input.response as { credentialId?: string } | null;
      const credentialID =
        response?.credentialId ?? `cred-${input.expectedChallenge}`;
      return {
        verified: true,
        registrationInfo: {
          credentialID,
          credentialPublicKey: `pk-${credentialID}`,
          counter: 0,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      };
    },
    async generateAuthenticationOptions(input) {
      return {
        challenge: challenge(),
        rpId: input.rpId,
        allowCredentials: (input.allowCredentials ?? []).map((c) => ({
          id: c.id,
          type: 'public-key',
        })),
      };
    },
    async verifyAuthenticationResponse(input) {
      return {
        verified: true,
        authenticationInfo: {
          newCounter: input.authenticator.counter + 1,
        },
      };
    },
  };
}
