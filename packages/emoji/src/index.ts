/**
 * Barrel exports for the Borjie emoji utilization layer.
 *
 * Tree-shake-safe — every module re-exported here is its own file. Import
 * the narrow path when you need only one helper:
 *   import { stepStatusEmoji } from '@borjie/emoji/stepper-status';
 * Or use this index for several at once:
 *   import { Emoji, getEmoji, ... } from '@borjie/emoji';
 *
 * Ported verbatim from sibling-port src/core/emoji.
 */

export * from "./universal-set";
export { Emoji, emojiChar, emojiPrefix } from "./Emoji";
export { default as EmojiComponent } from "./Emoji";
export * from "./stepper-status";
