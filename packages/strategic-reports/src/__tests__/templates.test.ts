/**
 * Template tests — each of the three template builders (HTML, Typst,
 * Carbone DOCX context) accepts a StrategicReport and produces a
 * non-empty output with the expected structural markers.
 */

import { describe, it, expect } from 'vitest';
import {
  buildHtmlSource,
  buildTypstSource,
  buildCarboneBinding,
  bindTemplate,
} from '../templates/index.js';
import { composerFor } from '../composers/index.js';
import { gathererFor } from '../gatherers/index.js';
import {
  buildSpec,
  createFakeBrain,
  fixtureAdvisorPorts,
} from './fixtures.js';
import { buildHarvardPhdPersona } from '../personas/harvard-phd-persona.js';

async function buildReport() {
  const spec = buildSpec('leasing_financial_performance');
  const evidence = await gathererFor(spec.type, fixtureAdvisorPorts)({ spec, now: () => new Date() });
  const persona = buildHarvardPhdPersona({ type: spec.type, audience: spec.audience, jurisdiction: spec.jurisdiction });
  const compose = composerFor(createFakeBrain());
  return compose({ evidence, persona, spec });
}

describe('HTML template', () => {
  it('produces non-empty HTML source with the report title', async () => {
    const report = await buildReport();
    const html = buildHtmlSource(report);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain(report.title);
    expect(html).toContain('Action plan');
    expect(html).toContain('Citations');
  });

  it('escapes HTML-unsafe characters in user content', async () => {
    const report = await buildReport();
    // Inject a synthetic dangerous title via a freshly cloned report.
    const dangerous = { ...report, title: '<script>alert(1)</script>' };
    const html = buildHtmlSource(dangerous);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('Typst template', () => {
  it('produces non-empty Typst source with structural markers', async () => {
    const report = await buildReport();
    const src = buildTypstSource(report);
    expect(src.length).toBeGreaterThan(0);
    expect(src).toContain('#set page(paper: "a4"');
    expect(src).toContain('== Executive summary');
    expect(src).toContain('== Action plan');
    expect(src).toContain('== Citations');
  });

  it('escapes Typst control characters', () => {
    const fakeReport = {
      type: 'leasing_financial_performance' as const,
      spec: buildSpec('leasing_financial_performance'),
      title: 'A title with # hash and $ dollar',
      executiveSummary: 'Has # and $ inside.',
      sections: [],
      citations: [],
      charts: [],
      tables: [],
      actionPlan: [],
      appendices: [],
      synthesis: { agreement: 1, escalate: false, proposerIds: ['t'], synthesizerId: 't', mode: 'merge' as const },
    };
    const src = buildTypstSource(fakeReport);
    expect(src).toContain('\\#');
    expect(src).toContain('\\$');
  });
});

describe('Carbone DOCX binding', () => {
  it('produces a binding with the report-type template id + context', async () => {
    const report = await buildReport();
    const binding = buildCarboneBinding(report);
    expect(binding.templateId).toBe(`strategic-report/${report.type}.docx`);
    expect(binding.context.meta.title).toBe(report.title);
    expect(binding.context.executiveSummary).toBe(report.executiveSummary);
    expect(binding.context.actionPlan.length).toBe(report.actionPlan.length);
    expect(binding.context.citations.length).toBe(report.citations.length);
    expect(binding.context.sections.length).toBe(report.sections.length);
  });

  it('stringifies table-row cells deterministically', async () => {
    const report = await buildReport();
    const binding = buildCarboneBinding(report);
    for (const sec of binding.context.sections) {
      for (const tbl of sec.tables) {
        for (const row of tbl.rows) {
          for (const cell of row) {
            expect(typeof cell).toBe('string');
          }
        }
      }
    }
  });
});

describe('bindTemplate — adapter dispatch by format', () => {
  it('returns typst binding for pdf', async () => {
    const report = await buildReport();
    const bound = bindTemplate('pdf', report);
    expect(bound.kind).toBe('typst');
    expect(bound.templateRef).toBe('strategic-report/typst');
  });
  it('returns carbone binding for docx', async () => {
    const report = await buildReport();
    const bound = bindTemplate('docx', report);
    expect(bound.kind).toBe('carbone');
    expect(bound.templateRef).toBe('strategic-report/carbone');
  });
  it('returns html binding for html', async () => {
    const report = await buildReport();
    const bound = bindTemplate('html', report);
    expect(bound.kind).toBe('html');
    expect(bound.templateRef).toBe('strategic-report/html');
  });
  it('returns html-pptx binding for pptx', async () => {
    const report = await buildReport();
    const bound = bindTemplate('pptx', report);
    expect(bound.kind).toBe('html');
    expect(bound.templateRef).toBe('strategic-report/html-pptx');
  });
});
