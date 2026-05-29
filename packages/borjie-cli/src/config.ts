/**
 * Runtime config helpers — defaults shared by every CLI verb.
 */

export const DEFAULT_API_BASE_URL =
  process.env['BORJIE_API_BASE_URL'] ?? 'https://api.borjie.app';

export const DEFAULT_CLIENT_ID = 'borjie-cli';
export const DEFAULT_CLIENT_LABEL = 'Borjie CLI (local)';

export const DEFAULT_SCOPES: readonly string[] = [
  'owner:read',
  'owner:write',
  'owner:draft',
  'owner:reminders',
  'owner:share',
];
