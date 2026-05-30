/**
 * Barrel exports for the Borjie emoji utilization layer.
 *
 * Tree-shake-safe — every module re-exported here is its own file. Import
 * the narrow path when you need only one helper:
 *   import { stepStatusEmoji } from '@/core/emoji/stepper-status';
 * Or use this index for several at once:
 *   import { Emoji, sentimentTap, ... } from '@/core/emoji';
 */

export * from "./universal-set";
export { Emoji, emojiChar, emojiPrefix } from "./Emoji";
export { default as EmojiComponent } from "./Emoji";
export * from "./stepper-status";
export * from "./adverse-action";
export * from "./domain-anchors";
export * from "./voice-ack";
export * from "./notification-prefix";
export { EmojiQuickReplies, QUICK_REPLIES } from "./quick-replies";
export type {
  EmojiQuickRepliesProps,
  QuickReplyIntent,
  QuickReplyOption,
} from "./quick-replies";
export { SentimentTap, SENTIMENT_OPTIONS } from "./sentiment-tap";
export type {
  SentimentTapProps,
  SentimentSignal,
  SentimentOption,
} from "./sentiment-tap";
export * from "./officer-file-tags";
export * from "./application-journey";
export * from "./compliance-light";
