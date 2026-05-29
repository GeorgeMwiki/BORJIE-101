/**
 * Brain SSE tab-tags protocol — parser + schema tests (CT-1).
 *
 * Six cases cover happy path, malformed JSON, unknown type, multiple
 * tags in one stream, length caps, and the proposal evidence-required
 * grounding rule.
 */

import { describe, expect, it } from 'vitest';

import {
  extractTabTags,
  pickProposalReason,
  pickTagTitle,
  type TabProposalTag,
  type TabSpawnTag,
  type TabUpdateTag,
} from '../tab-tags.js';

describe('extractTabTags', () => {
  it('parses <tab_spawn> with config + strips the tag from the body', () => {
    const text =
      'Sure, opening that for you. <tab_spawn type="finance" title="Gold Sales by Region" config=\'{"mineralKind":"gold","window":"quarter","groupBy":"region"}\' /> Anything else?';
    const result = extractTabTags(text);
    expect(result.dropped).toHaveLength(0);
    expect(result.body).toBe('Sure, opening that for you.  Anything else?');
    expect(result.tags).toHaveLength(1);
    const tag = result.tags[0] as TabSpawnTag;
    expect(tag.kind).toBe('tab_spawn');
    expect(tag.type).toBe('finance');
    expect(tag.title).toBe('Gold Sales by Region');
    expect(tag.config).toEqual({
      mineralKind: 'gold',
      window: 'quarter',
      groupBy: 'region',
    });
  });

  it('drops a tag with malformed JSON config + records the diagnostic', () => {
    const text =
      '<tab_spawn type="finance" title="Bad Config" config=\'{not-json\' />';
    const result = extractTabTags(text);
    expect(result.tags).toHaveLength(0);
    // Malformed JSON injects MALFORMED_JSON_SENTINEL so zod rejects with
    // a crisp issue pointing at `config`. The gateway's eval loop reads
    // these diagnostics to surface broken brain emits.
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.tagName).toBe('tab_spawn');
    expect(result.dropped[0]?.reason).toContain('config');
    expect(result.body).toBe('');
  });

  it('drops a tag whose type is not in the OWNER_OS_TAB_TYPES union', () => {
    const text = '<tab_spawn type="rocket-science" title="Mars Tab" />';
    const result = extractTabTags(text);
    expect(result.tags).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.tagName).toBe('tab_spawn');
    expect(result.dropped[0]?.reason).toContain('type');
  });

  it('parses multiple tags in one stream in emission order', () => {
    const text = [
      'I will open Compliance now.',
      '<tab_spawn type="compliance" title="NEMC review" config=\'{}\' />',
      'And update the existing finance tab to weekly:',
      '<tab_update id="finance|focus:gold-q1" config=\'{"window":"week"}\' />',
      'Closing the stale audit tab:',
      '<tab_remove id="audit|stale-2025" />',
    ].join(' ');
    const result = extractTabTags(text);
    expect(result.dropped).toHaveLength(0);
    expect(result.tags).toHaveLength(3);
    expect(result.tags.map((t) => t.kind)).toEqual([
      'tab_spawn',
      'tab_update',
      'tab_remove',
    ]);
    const update = result.tags[1] as TabUpdateTag;
    expect(update.id).toBe('finance|focus:gold-q1');
    expect(update.config).toEqual({ window: 'week' });
    expect(result.body).not.toContain('<tab_spawn');
    expect(result.body).not.toContain('<tab_update');
    expect(result.body).not.toContain('<tab_remove');
  });

  it('enforces length caps: title > 60 chars is dropped', () => {
    const longTitle = 'x'.repeat(61);
    const text = `<tab_spawn type="finance" title="${longTitle}" />`;
    const result = extractTabTags(text);
    expect(result.tags).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reason).toContain('title');
  });

  it('requires ≥1 evidenceId on <tab_proposal> and supports bilingual reason', () => {
    // Missing evidenceIds → drop (grounding rule).
    const without =
      '<tab_proposal type="finance" title="Pin Royalty Tracker" reason="3 drills this week" />';
    const r1 = extractTabTags(without);
    expect(r1.tags).toHaveLength(0);
    expect(r1.dropped).toHaveLength(1);
    expect(r1.dropped[0]?.reason).toContain('evidenceIds');

    // With evidence + bilingual reason → keep.
    const text =
      '<tab_proposal type="finance" title="Pin Royalty Tracker" titleSw="Bandika Kifuatiliaji" reason="3 drill-downs this week on Mwadui" reasonSw="Mara 3 wiki hii kwenye Mwadui" evidenceIds=\'["obs-1","obs-2"]\' confidence="0.82" />';
    const r2 = extractTabTags(text);
    expect(r2.dropped).toHaveLength(0);
    expect(r2.tags).toHaveLength(1);
    const tag = r2.tags[0] as TabProposalTag;
    expect(tag.kind).toBe('tab_proposal');
    expect(tag.type).toBe('finance');
    expect(tag.evidenceIds).toEqual(['obs-1', 'obs-2']);
    expect(tag.confidence).toBeCloseTo(0.82);
    expect(pickTagTitle(tag, 'sw')).toBe('Bandika Kifuatiliaji');
    expect(pickTagTitle(tag, 'en')).toBe('Pin Royalty Tracker');
    expect(pickProposalReason(tag, 'sw')).toBe('Mara 3 wiki hii kwenye Mwadui');
    expect(pickProposalReason(tag, 'en')).toBe(
      '3 drill-downs this week on Mwadui',
    );
  });
});
