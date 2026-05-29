/**
 * @borjie/cli — programmatic entry. The default consumer is the
 * `borjie` bin (see ./cli.ts); this module re-exports the per-verb
 * implementations + the SOTA upgrade modules (config, profiles,
 * sessions, plugins, agent) so embedders can call them directly
 * without spawning a subprocess.
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

export { replCommand } from './commands/repl.js';
export { diffCommand, resolveTimestamp } from './commands/diff.js';
export type { EstateSnapshotDiff, ChangeSummary } from './commands/diff.js';
export { watchCommand } from './commands/watch.js';
export { agentRunCommand, type AgentStep, type ToolRunner } from './commands/agent.js';
export {
  pluginInstallCommand,
  pluginLsCommand,
  pluginRemoveCommand,
} from './commands/plugin.js';
export {
  profilesLsCommand,
  profilesRmCommand,
  useProfileCommand,
} from './commands/profiles.js';
export {
  sessionsArchiveCommand,
  sessionsLsCommand,
  sessionsNewCommand,
  sessionsResumeCommand,
  sessionsShowCommand,
} from './commands/sessions.js';
export {
  configGetCommand,
  configPathCommand,
  configSetCommand,
  configShowCommand,
} from './commands/config.js';
export {
  completeDynamic,
  completionCommand,
  generateCompletion,
} from './commands/completion.js';

export { buildProgram, CLI_VERSION } from './cli-program.js';
export { createLogger, type BorjieLogger } from './logger.js';
export {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  credentialsFilePath,
  type BorjieCredentials,
} from './credentials.js';
export {
  createHttpClient,
  HttpError,
  type HttpClient,
  type HttpTraceEvent,
} from './http.js';

// New SOTA modules
export {
  loadUserConfig,
  saveUserConfig,
  defaultUserConfig,
  type UserConfig,
} from './user-config.js';
export {
  borjieHome,
  configFilePath,
  historyFilePath,
  profilesDir,
  profileFilePath,
  sessionsDir,
  sessionFilePath,
  agentRunsDir,
  agentRunFilePath,
  updateCheckFilePath,
  ensureBorjieDir,
} from './paths.js';
export { parseToml, stringifyToml, type TomlDoc, type TomlValue, type TomlTable } from './toml.js';
export {
  listProfiles,
  loadProfile,
  saveProfile,
  deleteProfile,
  credsToProfile,
  type BorjieProfile,
} from './profiles.js';
export {
  archiveSession,
  deleteSession,
  listSessions,
  loadSession,
  mostRecentSessionId,
  newSession,
  touchSession,
  type BorjieSession,
} from './sessions.js';
export {
  discoverPlugins,
  loadPlugins,
  type BorjiePluginModule,
  type DiscoveredPlugin,
  type PluginContext,
} from './plugins.js';
export {
  normaliseError,
  printPrettyError,
  type BorjieErrorKind,
  type NormalisedError,
} from './errors.js';
export {
  isStdinSentinel,
  readStdin,
  resolveStdinArg,
} from './stdin.js';
export {
  maybeNotifyUpdate,
  isNewer,
  type UpdateCheckResult,
} from './update-notifier.js';
