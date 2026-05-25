/**
 * Load `borjie.codeowners.yml` and validate with zod.
 */

import { parse as parseYaml } from 'yaml';

import { codeownersConfigSchema, type CodeownersConfig } from './types.js';

export function loadCodeownersConfigFromYml(yml: string): CodeownersConfig {
  const data = parseYaml(yml);
  if (!data || typeof data !== 'object') {
    throw new Error('borjie.codeowners.yml is empty or not an object.');
  }
  return codeownersConfigSchema.parse(data);
}

/** The default skeleton — used by `init` to seed a new tenant. */
export const DEFAULT_BORJIE_CODEOWNERS_YML = `defaultOwners:
  - '@platform-admin'
ruleSets:
  finance:
    paths:
      - 'services/payments-ledger/**'
      - 'packages/connectors/m-pesa/**'
    owners:
      - '@finance-lead'
      - '@finance-deputy'
  database:
    paths:
      - 'packages/database/src/migrations/**'
    owners:
      - '@db-lead'
  selfPolicy:
    paths:
      - '.claude/**'
      - '.github/workflows/**'
      - 'packages/self-codegen/**'
    owners:
      - '@platform-admin'
      - '@security-lead'
`;
