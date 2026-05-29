/**
 * MCP prompts/list — canned prompt templates an external client can pull.
 *
 * These are NOT system prompts for Mr. Mwikila (that lives in
 * api-gateway). They are templates an external agent fetches to scaffold
 * a Borjie-shaped conversation locally before it calls a tool.
 */

import type { BorjieMcpPrompt, BorjieMcpPromptMessage } from './types.js';

const obj = <T>(v: T): T => Object.freeze(v) as T;
const arr = <T>(v: ReadonlyArray<T>): ReadonlyArray<T> => Object.freeze(v);

export const BORJIE_PUBLIC_MCP_PROMPTS: ReadonlyArray<BorjieMcpPrompt> =
  Object.freeze([
    obj({
      name: 'mining_daily_brief_request',
      description:
        'Ask Mr. Mwikila for today s daily brief in Swahili and English.',
      arguments: arr([
        obj({
          name: 'asOfDate',
          description: 'ISO date (YYYY-MM-DD). Defaults to today.',
          required: false,
        }),
      ]),
    }),
    obj({
      name: 'draft_memo_to_buyer',
      description:
        'Compose a bilingual memo to a mineral buyer in the marketplace.',
      arguments: arr([
        obj({
          name: 'buyerName',
          description: 'Display name of the buyer.',
          required: true,
        }),
        obj({
          name: 'subject',
          description: 'Memo subject line.',
          required: true,
        }),
      ]),
    }),
    obj({
      name: 'opportunity_scan_then_act',
      description:
        'Run opportunity scan, then propose three actions, then ask for owner confirmation before any write.',
      arguments: arr([]),
    }),
    obj({
      name: 'decision_log_with_rationale',
      description:
        'Walk the owner through logging a decision with rationale + expected outcome so the retrospective worker can rate it in 24h.',
      arguments: arr([]),
    }),
  ]);

export function findPrompt(name: string): BorjieMcpPrompt | undefined {
  return BORJIE_PUBLIC_MCP_PROMPTS.find((p) => p.name === name);
}

/**
 * Render a prompt to its canonical message list. The text strings below
 * are deliberately concise — external agents will inflate them with
 * runtime context.
 */
export function renderPrompt(
  name: string,
  args: Readonly<Record<string, string>>,
): ReadonlyArray<BorjieMcpPromptMessage> | undefined {
  switch (name) {
    case 'mining_daily_brief_request': {
      const asOfDate = args['asOfDate'] ?? 'today';
      return arr([
        obj({
          role: 'user' as const,
          content: obj({
            type: 'text' as const,
            text: `Mr. Mwikila, give me my daily brief for ${asOfDate} in Swahili and English. Include production deltas, cash deltas, incident summary, licence countdown.`,
          }),
        }),
      ]);
    }
    case 'draft_memo_to_buyer': {
      const buyer = args['buyerName'] ?? 'the buyer';
      const subj = args['subject'] ?? 'follow-up';
      return arr([
        obj({
          role: 'user' as const,
          content: obj({
            type: 'text' as const,
            text: `Compose a bilingual memo to ${buyer} with subject "${subj}". Use sw as primary, en as secondary. Cite evidence_ids from the marketplace listings.`,
          }),
        }),
      ]);
    }
    case 'opportunity_scan_then_act': {
      return arr([
        obj({
          role: 'user' as const,
          content: obj({
            type: 'text' as const,
            text: 'Run mining_opportunities_scan. Summarise the top three opportunities. Propose one concrete action for each. Wait for owner confirmation before any write.',
          }),
        }),
      ]);
    }
    case 'decision_log_with_rationale': {
      return arr([
        obj({
          role: 'user' as const,
          content: obj({
            type: 'text' as const,
            text: 'I am about to make a decision. Walk me through writing the rationale and expected outcome so decisions_create can log it and the 24h retrospective worker can rate it.',
          }),
        }),
      ]);
    }
    default:
      return undefined;
  }
}
