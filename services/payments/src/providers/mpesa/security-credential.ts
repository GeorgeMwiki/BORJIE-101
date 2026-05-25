/**
 * M-Pesa Daraja SecurityCredential builder.
 *
 * Daraja B2C + Reversal requests require the initiator password to be
 * RSA-encrypted with Safaricom's public certificate, then base64-encoded
 * and sent as the `SecurityCredential` field. Previously this field was
 * left empty, which caused every B2C call to fail with an auth error.
 *
 * Safaricom publishes two certificates (sandbox and production); callers
 * must supply the correct one via `MPESA_SANDBOX_CERT` /
 * `MPESA_PRODUCTION_CERT` env vars (PEM-encoded) or point to a file via
 * `MPESA_CERT_PATH`.
 *
 * Encryption spec (from Daraja docs):
 *   algorithm : RSA / PKCS1 v1.5 padding
 *   encoding  : base64 of the ciphertext
 *   input     : the raw initiator password (NOT pre-hashed)
 */

import { publicEncrypt, constants, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type MpesaEnvironment = 'sandbox' | 'production';

export class SecurityCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityCredentialError';
  }
}

function resolveCertificatePem(env: MpesaEnvironment): string {
  // Priority: explicit PEM env var → filesystem path → fail.
  const envVar =
    env === 'production' ? 'MPESA_PRODUCTION_CERT' : 'MPESA_SANDBOX_CERT';
  const pem = process.env[envVar]?.trim();
  if (pem) return pem;

  const certPath = process.env.MPESA_CERT_PATH?.trim();
  if (certPath) {
    try {
      if (!certPath.startsWith('/') || certPath.includes('\0')) {
        throw new SecurityCredentialError(
          'MPESA_CERT_PATH must be an absolute path'
        );
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied absolute path, validated
      return readFileSync(certPath, 'utf-8');
    } catch (err) {
      throw new SecurityCredentialError(
        `failed to read MPESA_CERT_PATH ${certPath}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  throw new SecurityCredentialError(
    `Missing M-Pesa ${env} certificate. Set ${envVar} (PEM string) or MPESA_CERT_PATH (file path). ` +
      `Download from https://developer.safaricom.co.ke/ and supply via env.`
  );
}

/**
 * Generate the SecurityCredential for a Daraja B2C / Reversal request.
 *
 * @param initiatorPassword   the initiator account's plaintext password
 * @param env                 'sandbox' | 'production' — picks the cert
 * @returns                   base64-encoded RSA ciphertext
 */
export function generateSecurityCredential(
  initiatorPassword: string,
  env: MpesaEnvironment
): string {
  if (!initiatorPassword) {
    throw new SecurityCredentialError('initiatorPassword is required');
  }
  const pem = resolveCertificatePem(env);

  // createPublicKey validates the PEM format up-front with a clear
  // error; publicEncrypt's own error would be less actionable.
  let key;
  try {
    key = createPublicKey(pem);
  } catch (err) {
    throw new SecurityCredentialError(
      `invalid M-Pesa certificate PEM: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const ciphertext = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(initiatorPassword, 'utf-8')
  );
  return ciphertext.toString('base64');
}
