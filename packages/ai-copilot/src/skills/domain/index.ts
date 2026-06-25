/**
 * Domain skill bundle — Offtake, Maintenance, HR, Migration.
 */

export * from './offtake.js';
export * from './maintenance.js';
export * from './hr.js';
export * from './migration.js';
export * from './migration-commit.js';

import { OFFTAKE_SKILL_TOOLS } from './offtake.js';
import { MAINTENANCE_SKILL_TOOLS } from './maintenance.js';
import { HR_SKILL_TOOLS } from './hr.js';
import { MIGRATION_SKILL_TOOLS } from './migration.js';
import { migrationDiffAdvancedTool } from './migration-commit.js';

export const DOMAIN_SKILL_TOOLS = [
  ...OFFTAKE_SKILL_TOOLS,
  ...MAINTENANCE_SKILL_TOOLS,
  ...HR_SKILL_TOOLS,
  ...MIGRATION_SKILL_TOOLS,
  migrationDiffAdvancedTool,
];
