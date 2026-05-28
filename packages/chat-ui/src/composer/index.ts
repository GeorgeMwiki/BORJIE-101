/**
 * @borjie/chat-ui/composer — slash command + `@`-reference primitives.
 *
 * This barrel is shared across every Borjie chat surface (marketing,
 * owner-web, admin-web, workforce-mobile, buyer-mobile) per the
 * Chat-First Manifesto principle 8 (slash commands) + principle 9
 * (`@`-references). It is intentionally renderer-pure: the surface
 * supplies the slash command catalog + entity provider via props.
 *
 * See `Docs/RESEARCH/CHAT_FIRST_SOTA.md` §11–12 for the design intent.
 */
export {
  parseTrigger,
  filterSlashCommands,
  filterEntities,
  applySelection,
  buildTriggerProbe,
} from './trigger-parser';
export type {
  TriggerKind,
  TriggerState,
  SlashCommand,
  EntityReference,
  ComposerSelection,
} from './trigger-parser';

export { SlashMenu, AtMenu } from './ComposerMenus';
export type {
  SlashMenuProps,
  AtMenuProps,
  MenuItemLabel,
} from './ComposerMenus';
