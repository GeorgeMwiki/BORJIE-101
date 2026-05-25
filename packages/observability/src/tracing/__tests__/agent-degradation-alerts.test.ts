/**
 * Structural tests for the Phase D6 deliverables that live outside the
 * TypeScript build:
 *
 *   - infra/grafana/alerts/agent-degradation.yaml — Prometheus alert
 *     rules (parseability + required alerts + label coverage)
 *   - infra/grafana/dashboards/agent-per-port.json
 *   - infra/grafana/dashboards/agent-judge-confidence.json
 *   - infra/grafana/dashboards/agent-drift.json
 *
 * The YAML test deliberately avoids pulling a parser dependency into
 * @borjie/observability — we read the file as text and assert the
 * key alert keywords + expression shapes. This is enough to catch
 * accidental mass-deletion / mis-naming during a refactor; full
 * `promtool` validation lives in CI.
 *
 * The dashboard JSON tests do parse — `JSON.parse` is built in — and
 * assert the schema fields Grafana 11 requires (`schemaVersion`,
 * `uid`, `title`, `panels[]`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve the repo root from the package's CWD. The test runs from
// packages/observability/, so two `..` segments land us at the repo
// root regardless of vitest config.
const REPO_ROOT = resolve(process.cwd(), '..', '..');

const ALERT_RULES_PATH = resolve(
  REPO_ROOT,
  'infra/grafana/alerts/agent-degradation.yaml',
);
const DASH_PER_PORT_PATH = resolve(
  REPO_ROOT,
  'infra/grafana/dashboards/agent-per-port.json',
);
const DASH_JUDGE_CONF_PATH = resolve(
  REPO_ROOT,
  'infra/grafana/dashboards/agent-judge-confidence.json',
);
const DASH_DRIFT_PATH = resolve(
  REPO_ROOT,
  'infra/grafana/dashboards/agent-drift.json',
);

// ---------------------------------------------------------------------------
// Alert rules YAML
// ---------------------------------------------------------------------------

describe('infra/grafana/alerts/agent-degradation.yaml', () => {
  const text = readFileSync(ALERT_RULES_PATH, 'utf8');

  it('declares the borjie_agent_degradation group', () => {
    expect(text).toContain('name: borjie_agent_degradation');
  });

  it('declares the four required alert names', () => {
    expect(text).toContain('alert: AgentPortDegradedHigh');
    expect(text).toContain('alert: JudgeScoreDropP50');
    expect(text).toContain('alert: PersonaDriftBreach');
    expect(text).toContain('alert: ConfidenceCollapse');
  });

  it('AgentPortDegradedHigh reads agent_port_degraded_total over a 10m window', () => {
    expect(text).toMatch(
      /AgentPortDegradedHigh[\s\S]*agent_port_degraded_total[\s\S]*\[10m\]/,
    );
  });

  it('JudgeScoreDropP50 uses histogram_quantile(0.5) on judge_score_seconds_bucket', () => {
    expect(text).toMatch(
      /JudgeScoreDropP50[\s\S]*histogram_quantile\(\s*\n?\s*0\.5,[\s\S]*judge_score_seconds_bucket/,
    );
  });

  it('PersonaDriftBreach reads persona_drift_event_count over a 1h window', () => {
    expect(text).toMatch(
      /PersonaDriftBreach[\s\S]*persona_drift_event_count[\s\S]*\[1h\]/,
    );
  });

  it('ConfidenceCollapse uses histogram_quantile(0.5) on confidence_overall_seconds_bucket < 0.4', () => {
    expect(text).toMatch(
      /ConfidenceCollapse[\s\S]*histogram_quantile\(\s*\n?\s*0\.5,[\s\S]*confidence_overall_seconds_bucket[\s\S]*<\s*0\.4/,
    );
  });

  it('every alert carries a severity label', () => {
    // Count the alert: lines and the severity: lines — they MUST match.
    const alertCount = (text.match(/^\s*-\s*alert:\s/gm) ?? []).length;
    const severityCount = (text.match(/^\s+severity:\s+(critical|warning)/gm)
      ?? []).length;
    expect(alertCount).toBe(4);
    expect(severityCount).toBe(4);
  });

  it('all critical alerts come from page-worthy classes', () => {
    // Three of four are page-grade (critical), one (drift) is warning.
    const criticalMatches = (text.match(/severity:\s+critical/g) ?? []).length;
    const warningMatches = (text.match(/severity:\s+warning/g) ?? []).length;
    expect(criticalMatches).toBe(3);
    expect(warningMatches).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Dashboard JSON — structural assertions only. Grafana's full schema
// is large, so we lock in the fields a Grafana 11 import path requires
// + the panels we expect to be present.
// ---------------------------------------------------------------------------

interface DashboardLite {
  readonly title?: string;
  readonly uid?: string;
  readonly schemaVersion?: number;
  readonly panels?: ReadonlyArray<{
    readonly title?: string;
    readonly type?: string;
    readonly targets?: ReadonlyArray<{ readonly expr?: string }>;
  }>;
  readonly templating?: {
    readonly list?: ReadonlyArray<{ readonly name?: string }>;
  };
  readonly tags?: ReadonlyArray<string>;
}

const loadDash = (p: string): DashboardLite =>
  JSON.parse(readFileSync(p, 'utf8')) as DashboardLite;

describe('infra/grafana/dashboards/agent-per-port.json', () => {
  const dash = loadDash(DASH_PER_PORT_PATH);

  it('is valid JSON with the required Grafana 11 fields', () => {
    expect(dash.title).toBe('BORJIE Agent — Per-Port');
    expect(dash.uid).toBe('borjie-agent-per-port');
    expect(dash.schemaVersion).toBeGreaterThanOrEqual(38);
    expect(Array.isArray(dash.panels)).toBe(true);
    expect(dash.panels!.length).toBeGreaterThan(0);
  });

  it('plots agent.call.success_total / error_total / duration_seconds', () => {
    const allExprs = (dash.panels ?? [])
      .flatMap((p) => p.targets ?? [])
      .map((t) => t.expr ?? '')
      .join(' || ');
    expect(allExprs).toContain('agent_call_success_total');
    expect(allExprs).toContain('agent_call_error_total');
    expect(allExprs).toContain('agent_call_duration_seconds_bucket');
  });

  it('exposes port_name as a templating variable', () => {
    const vars = (dash.templating?.list ?? []).map((v) => v.name);
    expect(vars).toContain('port_name');
    expect(vars).toContain('agent');
  });

  it('plots p50, p95, and p99 latency quantiles', () => {
    const text = JSON.stringify(dash);
    expect(text).toContain('histogram_quantile(0.50');
    expect(text).toContain('histogram_quantile(0.95');
    expect(text).toContain('histogram_quantile(0.99');
  });
});

describe('infra/grafana/dashboards/agent-judge-confidence.json', () => {
  const dash = loadDash(DASH_JUDGE_CONF_PATH);

  it('declares uid + title for provisioning import', () => {
    expect(dash.uid).toBe('borjie-agent-judge-confidence');
    expect(dash.title).toContain('Judge & Confidence');
    expect(dash.schemaVersion).toBeGreaterThanOrEqual(38);
  });

  it('reads judge_score_seconds_bucket + confidence_overall_seconds_bucket', () => {
    const text = JSON.stringify(dash);
    expect(text).toContain('judge_score_seconds_bucket');
    expect(text).toContain('confidence_overall_seconds_bucket');
  });

  it('includes at least one heatmap-type panel for distribution view', () => {
    const types = (dash.panels ?? []).map((p) => p.type);
    expect(types).toContain('heatmap');
  });
});

describe('infra/grafana/dashboards/agent-drift.json', () => {
  const dash = loadDash(DASH_DRIFT_PATH);

  it('declares uid + title for provisioning import', () => {
    expect(dash.uid).toBe('borjie-agent-drift');
    expect(dash.title).toContain('Drift');
    expect(dash.schemaVersion).toBeGreaterThanOrEqual(38);
  });

  it('reads persona_drift_event_count', () => {
    const text = JSON.stringify(dash);
    expect(text).toContain('persona_drift_event_count');
  });

  it('breaks events down by verdict (warn / soften / block)', () => {
    const text = JSON.stringify(dash);
    expect(text).toContain('verdict=\\"block\\"');
    expect(text).toContain('verdict=\\"soften\\"');
    expect(text).toContain('verdict=\\"warn\\"');
  });
});
