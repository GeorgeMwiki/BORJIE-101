/**
 * @borjie/document-ai/form-extraction — public barrel.
 */

export { extractFormFields } from './extract.js';
export type { ExtractFormFieldsConfig } from './extract.js';

export {
  PRESHIPPED_SCHEMAS,
  leaseAgreementSchema,
  bankStatementSchema,
  idCardSchema,
  receiptSchema,
  invoiceSchema,
  utilityBillSchema,
} from './schemas.js';
export type { NamedSchema } from './schemas.js';
