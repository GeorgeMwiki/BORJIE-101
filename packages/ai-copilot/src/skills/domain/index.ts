/**
 * Domain skill bundle — Leasing, Maintenance, Finance, Comms, HR, Migration.
 */

export * from './leasing.js';
export * from './maintenance.js';
export * from './finance.js';
export * from './comms.js';
export * from './hr.js';
export * from './migration.js';
export * from './migration-commit.js';

import { LEASING_SKILL_TOOLS } from './leasing.js';
import { MAINTENANCE_SKILL_TOOLS } from './maintenance.js';
import { FINANCE_SKILL_TOOLS } from './finance.js';
import { COMMS_SKILL_TOOLS } from './comms.js';
import { HR_SKILL_TOOLS } from './hr.js';
import { MIGRATION_SKILL_TOOLS } from './migration.js';
import { migrationDiffAdvancedTool } from './migration-commit.js';

export const DOMAIN_SKILL_TOOLS = [
  ...LEASING_SKILL_TOOLS,
  ...MAINTENANCE_SKILL_TOOLS,
  ...FINANCE_SKILL_TOOLS,
  ...COMMS_SKILL_TOOLS,
  ...HR_SKILL_TOOLS,
  ...MIGRATION_SKILL_TOOLS,
  migrationDiffAdvancedTool,
];
