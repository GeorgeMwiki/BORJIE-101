/**
 * `@borjie/brain-llm-router/kill-switch` — public surface.
 */

export {
  isKillSwitchActive,
  buildKillSwitchPrompt,
  setKillSwitchDbReader,
  resetKillSwitchDbReader,
  type KillSwitchLanguage,
  type KillSwitchDbReader,
} from './kill-switch.js';
