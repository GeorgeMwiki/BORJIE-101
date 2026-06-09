/**
 * Generated-tab dynamic localization tests (W3d).
 *
 * The owner's ACTIVE locale (`en` default, `sw` toggle) threads through
 * the whole generation path: the brain AUTHORS every label in that single
 * language, and the deterministic fallback runs a phrase-map locale pass.
 * CLAUDE.md EN/SW absolute separation — a `sw` owner must NEVER see an
 * English tab and vice-versa.
 *
 * These tests lock:
 *   1. fallback path: locale=sw ⇒ Swahili labels (no English leakage);
 *      locale=en ⇒ English.
 *   2. LLM path: the system prompt + user message carry the absolute
 *      single-language directive in the target language.
 *   3. cache isolation: en and sw never share a slot.
 *   4. dictionary coverage: every string the shipped skeletons emit has a
 *      Swahili translation (no honest-degrade leak on the shipped path).
 */

import { describe, it, expect, vi } from 'vitest';
import { createTabGenerator } from '../generator/index.js';
import {
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
  renderGenerationLanguageDirective,
} from '../generator/index.js';
import { getDomainSkeleton, buildFallbackTab } from '../generator/index.js';
import { localizeSkeleton } from '../generator/index.js';
import { collectTabFields } from '../types.js';
import type {
  GeneratorBrainPort,
  GenerateTabInput,
} from '../generator/index.js';
import type { PortalTab, TabGenerationIntent } from '../types.js';

function baseIntent(
  overrides: Partial<TabGenerationIntent> = {},
): TabGenerationIntent {
  return {
    proposedTabKey: 'hr.payroll',
    proposedTabTitle: 'Payroll',
    domain: 'hr',
    confidence: 0.8,
    evidence: ['payroll'],
    sourceMessage: 'we need to track our staff payroll',
    usedLlm: false,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<GenerateTabInput> = {},
): GenerateTabInput {
  return {
    intent: baseIntent(),
    tenantId: 'tenant_1',
    userId: 'user_1',
    actorId: 'system',
    ...overrides,
  };
}

const fixedClock = () => new Date('2026-05-24T12:00:00.000Z');

/** Every human-visible string on a tab, flattened for leak assertions. */
function allLabelStrings(tab: PortalTab): string[] {
  const strings: string[] = [tab.title, tab.description];
  for (const section of tab.sections) {
    strings.push(section.title);
    if (section.description) strings.push(section.description);
    for (const field of section.fields) {
      strings.push(field.label);
      if (field.help) strings.push(field.help);
      for (const opt of field.options ?? []) strings.push(opt.label);
    }
    for (const widget of section.widgets) {
      strings.push(widget.title);
      const cfgLabel = widget.config?.label;
      if (typeof cfgLabel === 'string') strings.push(cfgLabel);
    }
  }
  return strings;
}

describe('W3d — fallback generator honours locale', () => {
  it('locale=sw yields Swahili labels (no English leakage)', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(baseInput({ locale: 'sw' }));
    expect(result.source).toBe('fallback');

    const labels = collectTabFields(result.tab).map((f) => f.label);
    // Canonical HR field labels are Swahili, not English.
    expect(labels).toContain('Jina kamili'); // Full name
    expect(labels).toContain('Mshahara ghafi'); // Gross pay
    expect(labels).not.toContain('Full name');
    expect(labels).not.toContain('Gross pay');

    // Section titles + description re-authored in Swahili.
    const sectionTitles = result.tab.sections.map((s) => s.title);
    expect(sectionTitles).toContain('Wafanyakazi'); // People
    expect(result.tab.description.startsWith('Tab iliyotengenezwa')).toBe(true);
  });

  it('locale=en yields English labels (default behaviour preserved)', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(baseInput({ locale: 'en' }));
    const labels = collectTabFields(result.tab).map((f) => f.label);
    expect(labels).toContain('Full name');
    expect(labels).toContain('Gross pay');
    expect(result.tab.sections.map((s) => s.title)).toContain('People');
  });

  it('omitted locale defaults to English (CLAUDE.md default)', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(baseInput());
    expect(collectTabFields(result.tab).map((f) => f.label)).toContain(
      'Full name',
    );
  });

  it('intent.locale is honoured when input.locale is unset', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(
      baseInput({ intent: baseIntent({ locale: 'sw' }) }),
    );
    expect(result.tab.sections.map((s) => s.title)).toContain('Wafanyakazi');
  });

  it('input.locale takes precedence over intent.locale', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const result = await gen.generate(
      baseInput({ locale: 'en', intent: baseIntent({ locale: 'sw' }) }),
    );
    expect(result.tab.sections.map((s) => s.title)).toContain('People');
  });

  it('sw dropdown OPTION labels are Swahili but option VALUES stay machine-stable', async () => {
    const tab = buildFallbackTab({
      intent: baseIntent({ locale: 'sw' }),
      tenantId: 't',
      userId: null,
      actorId: 'system',
      nowIso: '2026-05-24T12:00:00.000Z',
      id: 'tab_x',
      sourceConversationId: undefined,
    });
    const employmentType = collectTabFields(tab).find(
      (f) => f.key === 'employment_type',
    );
    expect(employmentType?.options?.map((o) => o.value)).toEqual([
      'full_time',
      'part_time',
      'contractor',
    ]);
    expect(employmentType?.options?.map((o) => o.label)).toEqual([
      'Muda kamili',
      'Muda nusu',
      'Mkandarasi',
    ]);
  });
});

describe('W3d — every shipped skeleton string has a Swahili translation', () => {
  const DOMAINS = [
    'hr',
    'finance',
    'compliance',
    'procurement',
    'operations',
  ] as const;

  it.each(DOMAINS)(
    'no English string survives the sw locale pass for the %s skeleton',
    (domain) => {
      const skeleton = getDomainSkeleton(domain);
      const en = skeleton.sections;
      const sw = localizeSkeleton(skeleton.sections, 'sw');
      // Walk the two trees in lock-step: every human-visible string must
      // have CHANGED (Swahili) — none may equal its English source, which
      // would mean an untranslated leak on the shipped fallback path.
      en.forEach((enSection, si) => {
        const swSection = sw[si]!;
        expect(swSection.title).not.toBe(enSection.title);
        if (enSection.description) {
          expect(swSection.description).not.toBe(enSection.description);
        }
        enSection.fields.forEach((enField, fi) => {
          const swField = swSection.fields[fi]!;
          expect(swField.label).not.toBe(enField.label);
          (enField.options ?? []).forEach((enOpt, oi) => {
            expect(swField.options?.[oi]?.label).not.toBe(enOpt.label);
          });
        });
        enSection.widgets.forEach((enWidget, wi) => {
          expect(swSection.widgets[wi]!.title).not.toBe(enWidget.title);
        });
      });
    },
  );

  it('localizeSkeleton is a pure no-op shape for en and never mutates the source', () => {
    const skeleton = getDomainSkeleton('hr');
    const before = JSON.stringify(skeleton.sections);
    const en = localizeSkeleton(skeleton.sections, 'en');
    expect(en).not.toBe(skeleton.sections); // fresh array (immutability)
    expect(JSON.stringify(en)).toBe(before); // same strings
    expect(JSON.stringify(skeleton.sections)).toBe(before); // source intact
  });
});

describe('W3d — LLM path threads the absolute single-language directive', () => {
  it('sw system prompt carries the Swahili label directive, not English', () => {
    const system = buildGenerationSystemPrompt('sw');
    expect(system).toContain('# LUGHA YA LEBO (LAZIMA)');
    expect(system).toContain('Kiswahili PEKEE');
    expect(system).not.toContain('# LABEL LANGUAGE (REQUIRED)');
  });

  it('en system prompt carries the English label directive (default)', () => {
    expect(buildGenerationSystemPrompt()).toContain(
      '# LABEL LANGUAGE (REQUIRED)',
    );
    expect(buildGenerationSystemPrompt('en')).toContain('English ONLY');
  });

  it('the directive enumerates the generated string surfaces + keeps keys stable', () => {
    const sw = renderGenerationLanguageDirective('sw');
    expect(sw).toContain('lebo za sehemu'); // field labels (sw)
    expect(sw).toContain('tabKey'); // system keys called out as untouched
    const en = renderGenerationLanguageDirective('en');
    expect(en).toContain('field labels');
    expect(en).toContain('widget titles');
  });

  it('the user message echoes the owner locale + an in-locale reminder', () => {
    const swMsg = buildGenerationUserMessage({
      intent: baseIntent({ locale: 'sw' }),
      orgContext: undefined,
      locale: 'sw',
    });
    expect(swMsg).toContain('OWNER ACTIVE LOCALE: sw');
    expect(swMsg).toContain('andika title');

    const enMsg = buildGenerationUserMessage({
      intent: baseIntent(),
      orgContext: undefined,
      locale: 'en',
    });
    expect(enMsg).toContain('OWNER ACTIVE LOCALE: en');
    expect(enMsg).toContain('write the title');
  });

  it('passes the sw system prompt to the brain at generate time', async () => {
    const llmTab = {
      tabKey: 'hr.payroll',
      title: 'Mishahara',
      description: 'Tab ya mishahara',
      icon: 'wallet',
      domain: 'hr',
      sections: [
        {
          key: 'cycles',
          title: 'Mizunguko',
          fields: [{ key: 'cycle', label: 'Mzunguko', kind: 'text' }],
          widgets: [],
        },
      ],
      permissions: { visibleToPersonas: ['internal_admin'] },
    };
    const generate = vi.fn().mockResolvedValue({
      text: JSON.stringify(llmTab),
      modelId: 'claude-test',
    });
    const brain: GeneratorBrainPort = { generate };
    const gen = createTabGenerator({ brain, clock: fixedClock });
    const result = await gen.generate(baseInput({ locale: 'sw' }));
    expect(result.source).toBe('llm');
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0][0] as {
      system: string;
      userMessage: string;
    };
    expect(call.system).toContain('# LUGHA YA LEBO (LAZIMA)');
    expect(call.userMessage).toContain('OWNER ACTIVE LOCALE: sw');
    // The brain authored the labels — they flow through untouched.
    expect(allLabelStrings(result.tab)).toContain('Mishahara');
  });
});

describe('W3d — cache isolation by locale (en and sw never collide)', () => {
  it('en and sw of the same intent produce DIFFERENT tabs, no cross-locale cache hit', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const sw = await gen.generate(baseInput({ locale: 'sw' }));
    const en = await gen.generate(baseInput({ locale: 'en' }));
    expect(sw.source).toBe('fallback');
    // en must NOT be served the cached sw tab — it is its own fallback.
    expect(en.source).toBe('fallback');
    expect(en.tab.sections[0]!.title).not.toBe(sw.tab.sections[0]!.title);
    expect(en.tab.sections[0]!.title).toBe('People');
    expect(sw.tab.sections[0]!.title).toBe('Wafanyakazi');
  });

  it('repeating the SAME locale hits the cache', async () => {
    const gen = createTabGenerator({ clock: fixedClock });
    const first = await gen.generate(baseInput({ locale: 'sw' }));
    const second = await gen.generate(baseInput({ locale: 'sw' }));
    expect(first.source).toBe('fallback');
    expect(second.source).toBe('cache');
    // Cached sw tab is still Swahili.
    expect(second.tab.sections.map((s) => s.title)).toContain('Wafanyakazi');
  });
});
