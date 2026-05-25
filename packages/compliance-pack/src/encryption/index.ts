/**
 * Encryption — public exports.
 */

export {
  type EnvelopeEncryptor,
  type FieldBoundEncryptor,
  bindField,
} from './port.js';
export {
  createInMemoryEnvelopeEncryptor,
  digestEncryptionContext,
  type InMemoryEncryptorOptions,
} from './in-memory-adapter.js';
export {
  createAWSKMSEnvelopeEncryptor,
  type AWSKMSEncryptorOptions,
  type KMSClient,
} from './aws-kms-adapter.js';
