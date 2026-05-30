'use client';

/**
 * Message Bubble — carbon copy of LitFin's MessageBubble, Borjie-skinned.
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/MessageBubble.tsx
 */

import { motion } from 'framer-motion';
import { BorjieMark } from '../borjie/BorjieMark';
import { CHAT_USER_BUBBLE, CHAT_AI_BUBBLE } from '../litfin-primitives';
import { AIMessageText } from './AIMessageText';
import {
  InlineLearningBlocks,
  type InlineChatBlock,
} from './InlineLearningBlocks';
import type { JSX } from 'react';

export interface LitFinMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly timestamp?: string;
  readonly isStreaming?: boolean;
  /**
   * Inline learning-chat blocks. Narrow port of LitFin's chat-message-
   * level generative-UI pattern (concept_card + ui_block ONLY — NOT the
   * stepper / classroom / adaptive-layout framework).
   */
  readonly blocks?: ReadonlyArray<InlineChatBlock>;
}

interface LitFinMessageBubbleProps {
  readonly message: LitFinMessage;
  readonly showTimestamp?: boolean;
  readonly onPlayAudio?: (text: string) => void;
  readonly isPlayingAudio?: boolean;
  readonly language?: 'en' | 'sw';
}

export function LitFinMessageBubble({
  message,
  showTimestamp = true,
  onPlayAudio,
  isPlayingAudio,
  language = 'en',
}: LitFinMessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  const isStreamingMsg = message.isStreaming === true;
  const playLabel = language === 'sw' ? 'Sikiliza' : 'Play audio';
  const playingLabel = language === 'sw' ? 'Inacheza' : 'Playing audio';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, x: isUser ? 12 : -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      data-message-id={message.id}
    >
      <div
        className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} max-w-[85%]`}
      >
        {!isUser && (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
            <BorjieMark size={26} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className={`relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed transition-all duration-300 hover:-translate-y-[1px] ${
              isUser
                ? `${CHAT_USER_BUBBLE} hover:shadow-[0_22px_50px_rgb(15_23_42_/_0.16)]`
                : `${CHAT_AI_BUBBLE} hover:shadow-[0_14px_32px_rgb(15_23_42_/_0.08)] hover:border-border/60`
            }`}
            style={isStreamingMsg ? { contain: 'layout' } : undefined}
          >
            {!isUser && (
              <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-primary/40 via-emerald-500/30 to-cyan-500/20" />
            )}
            {isUser ? (
              <div className="whitespace-pre-wrap break-words">
                {message.content}
              </div>
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:my-2 prose-li:my-0.5 prose-p:my-1 prose-strong:font-semibold break-words">
                <AIMessageText content={message.content} />
                {isStreamingMsg && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary animate-pulse rounded-sm align-text-bottom" />
                )}
                {!isStreamingMsg &&
                  message.blocks &&
                  message.blocks.length > 0 && (
                    <InlineLearningBlocks blocks={message.blocks} />
                  )}
              </div>
            )}
          </div>
          <div
            className={`mt-1 flex items-center gap-2 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            {showTimestamp && message.timestamp && (
              <span className="text-[10px] text-muted-foreground">
                {formatTimestamp(message.timestamp)}
              </span>
            )}
            {!isUser && onPlayAudio && (
              <button
                type="button"
                onClick={() => onPlayAudio(message.content)}
                className={`inline-flex items-center justify-center rounded-full transition-all p-1 ${
                  isPlayingAudio
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground/60 hover:text-primary hover:bg-primary/5'
                }`}
                aria-label={isPlayingAudio ? playingLabel : playLabel}
                title={isPlayingAudio ? playingLabel : playLabel}
              >
                {isPlayingAudio ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const timeStr = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (diffDays === 0) return timeStr;
    if (diffDays === 1) return `Yesterday ${timeStr}`;
    if (diffDays < 7) {
      const dayName = date.toLocaleDateString([], { weekday: 'short' });
      return `${dayName} ${timeStr}`;
    }
    return (
      date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ` ${timeStr}`
    );
  } catch {
    return '';
  }
}
