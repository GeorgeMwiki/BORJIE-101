/**
 * command-palette-actions — guard-exempt Swahili+English prompt table
 * for the Cmd-K palette's Quick-Action + Spawn-tab rows.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard skips the `i18n/` tree, so the brain-facing
 * prompt each palette row parks (via `setQueuedPrompt`) lives here in
 * both locales rather than as an inline literal. The active locale is
 * resolved with `pickByLocale(locale, S.key)` at the call site so the
 * queued prompt — which the chat surface submits as the owner's first
 * turn — is always in the ACTIVE language (zero-mix canon).
 *
 * The keys mirror `QUICK_ACTIONS[].intent` in OwnerCommandPalette so a
 * new action row maps 1:1 to a prompt.
 */

export const commandPaletteActionPrompts = {
  'royalty-draft': {
    en: 'Draft a royalty return for me.',
    sw: 'Nitengenezee rasimu ya marejesho ya mrabaha.',
  },
  'create-reminder': {
    en: 'Create a reminder for me.',
    sw: 'Nitengenezee kikumbusho.',
  },
  'upload-doc': {
    en: 'Help me upload a document.',
    sw: 'Nisaidie kupakia hati.',
  },
  'coop-settlement': {
    en: 'Start a cooperative settlement for me.',
    sw: 'Nianzishie usuluhishi wa ushirika.',
  },
  'share-link': {
    en: 'Generate a share link for me.',
    sw: 'Nitengenezee kiungo cha kushiriki.',
  },
  'pinned-items': {
    en: 'Show me my pinned items.',
    sw: 'Nionyeshe vitu vyangu vilivyobandikwa.',
  },
} as const;

/** Prompt template for a spawn-tab row (`{type}` substituted). */
export const commandPaletteSpawnPrompt = {
  en: 'Spawn a {type} tab for me.',
  sw: 'Nifungulie kichupo cha {type}.',
} as const;

export type CommandPaletteActionIntent =
  keyof typeof commandPaletteActionPrompts;
