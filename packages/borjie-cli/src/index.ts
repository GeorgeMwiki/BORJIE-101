/**
 * @borjie/cli — programmatic entry. The default consumer is the
 * `borjie` bin (see ./cli.ts); this module re-exports the per-verb
 * implementations so embedders can call them directly without spawning
 * a subprocess.
 */

export { loginCommand, logoutCommand, whoamiCommand } from './commands/auth.js';
export { chatCommand } from './commands/chat.js';
export {
  draftsLsCommand,
  draftsNewCommand,
  draftsLockCommand,
  draftsShowCommand,
} from './commands/drafts.js';
export { remindersLsCommand, remindersAddCommand } from './commands/reminders.js';
export { estateSitesCommand, estateWorkersCommand } from './commands/estate.js';
export { complianceCheckCommand } from './commands/compliance.js';
export { scopeCommand } from './commands/scope.js';
export { opportunitiesCommand } from './commands/opportunities.js';
export { risksCommand } from './commands/risks.js';
export { decisionsLsCommand, decisionsShowCommand } from './commands/decisions.js';
export { shareCommand } from './commands/share.js';
export { tabsLsCommand, tabsOpenCommand } from './commands/tabs.js';

export { buildProgram } from './cli-program.js';
export { createLogger, type BorjieLogger } from './logger.js';
export {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  credentialsFilePath,
  type BorjieCredentials,
} from './credentials.js';
export { createHttpClient, HttpError, type HttpClient } from './http.js';
