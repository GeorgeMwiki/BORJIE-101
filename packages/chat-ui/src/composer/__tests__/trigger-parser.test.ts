/**
 * Trigger-parser tests — pure functions, no React.
 */

import { describe, expect, it } from 'vitest';
import {
  applySelection,
  buildTriggerProbe,
  filterEntities,
  filterSlashCommands,
  parseTrigger,
  type EntityReference,
  type SlashCommand,
} from '../trigger-parser';

describe('parseTrigger', () => {
  it('returns kind=none when there is no trigger token', () => {
    expect(parseTrigger('hello', 5).kind).toBe('none');
  });

  it('detects a slash trigger at line start', () => {
    const r = parseTrigger('/', 1);
    expect(r.kind).toBe('slash');
    expect(r.query).toBe('');
    expect(r.anchor).toBe(0);
  });

  it('detects a slash trigger after whitespace', () => {
    const r = parseTrigger('show me /find p', 15);
    expect(r.kind).toBe('slash');
    expect(r.query).toBe('find p');
  });

  it('ignores a `/` that is part of a URL', () => {
    expect(parseTrigger('https://example.com/path', 24).kind).toBe('none');
  });

  it('detects an @ trigger', () => {
    const r = parseTrigger('@geita', 6);
    expect(r.kind).toBe('at');
    expect(r.query).toBe('geita');
  });

  it('ignores an @ that follows a non-space char (looks like email)', () => {
    expect(parseTrigger('me@example.com', 14).kind).toBe('none');
  });

  it('closes the window when whitespace lands in the query', () => {
    expect(parseTrigger('/find parcel today', 18).kind).toBe('none');
  });
});

describe('filterSlashCommands', () => {
  const cmds: SlashCommand[] = [
    { id: 'spawn-compliance', label: { en: 'Spawn compliance', sw: 'Anza utii' } },
    { id: 'draft-tra', label: { en: 'Draft TRA letter', sw: 'Andaa barua ya TRA' } },
    {
      id: 'fleet-rollup',
      label: { en: 'Fleet rollup', sw: 'Muhtasari wa kundi' },
      personaSlugs: ['T2_admin_strategist'],
    },
  ];

  it('returns all commands for empty query', () => {
    expect(filterSlashCommands(cmds, '').length).toBe(3);
  });

  it('filters by label substring (en)', () => {
    const r = filterSlashCommands(cmds, 'tra', { locale: 'en' });
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe('draft-tra');
  });

  it('respects persona allowlist', () => {
    const r = filterSlashCommands(cmds, 'fleet', {
      personaSlug: 'T1_owner_strategist',
    });
    expect(r).toHaveLength(0);
  });
});

describe('filterEntities', () => {
  const entities: EntityReference[] = [
    {
      id: 'geita-pml',
      label: { en: 'Geita PML', sw: 'PML ya Geita' },
      kind: 'site',
    },
    {
      id: 'pml-0241',
      label: { en: 'PML/0241/2023', sw: 'PML/0241/2023' },
      kind: 'licence',
    },
    {
      id: 'parcel-241',
      label: { en: 'Dore bar #241', sw: 'Vifurushi #241' },
      kind: 'parcel',
    },
  ];

  it('filters by kind', () => {
    const r = filterEntities(entities, '', { kinds: ['licence'] });
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe('pml-0241');
  });

  it('filters by query', () => {
    const r = filterEntities(entities, 'geita');
    expect(r).toHaveLength(1);
    expect(r[0]?.kind).toBe('site');
  });
});

describe('applySelection', () => {
  it('replaces the slash trigger window with the selected token', () => {
    const text = 'show me /find ';
    const trigger = parseTrigger(text, 13);
    const next = applySelection(
      { text, caret: 13 },
      trigger,
      { token: '/spawn-compliance' },
    );
    expect(next.text).toBe('show me /spawn-compliance  ');
    expect(next.caret).toBe(26);
  });

  it('replaces the at trigger window with the entity token', () => {
    const text = 'open @geita';
    const trigger = parseTrigger(text, 11);
    const next = applySelection(
      { text, caret: 11 },
      trigger,
      { token: '@geita-pml' },
    );
    expect(next.text).toBe('open @geita-pml ');
    expect(next.caret).toBe(16);
  });
});

describe('buildTriggerProbe', () => {
  it('returns the active trigger from a selection snapshot', () => {
    const r = buildTriggerProbe({ text: '/draft', caret: 6 });
    expect(r.kind).toBe('slash');
    expect(r.query).toBe('draft');
  });
});
