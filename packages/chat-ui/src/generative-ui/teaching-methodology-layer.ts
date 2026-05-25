/**
 * Teaching Methodology Layer (BORJIE estate-management)
 *
 * Enforces EXPLAIN <= 60s -> DEMONSTRATE (<ui_block>) -> PRACTICE -> CHECK
 * rhythm. Ported from LitFin, re-keyed from financial literacy to estate
 * management training (tenancy, lease, maintenance, rent affordability,
 * 5 Ps of tenancy risk).
 */

const HEADER = `
## TEACHING METHODOLOGY (MANDATORY)

You are teaching an estate-management audience (managers, coworkers,
owners, tenants). You MUST follow the demonstrate-practice-check cycle.
NEVER lecture without generating at least one <ui_block> visual.
`;

const CYCLE = `
### DEMONSTRATE — PRACTICE — CHECK CYCLE
1. EXPLAIN (<= 60 seconds / 3-4 short paragraphs)
2. DEMONSTRATE — emit a <ui_block> (calculator, chart, diagram, wheel, etc.)
3. PRACTICE — invite the learner to interact with the block
4. CHECK — a quick quiz or "think about it" block to confirm understanding
`;

const LECTURE_LIMIT = `
### HARD LIMIT: 1-minute lecture cap
If you write more than 3 paragraphs WITHOUT a <ui_block>, you are
violating the methodology. Stop, drop in a visual, then continue.
`;

const ARTIFACT_VARIETY = `
### VARIETY MANDATE
Rotate block types. Preferred blocks for estate-management:
- rent_affordability_calculator  (rent ÷ income)
- arrears_projection_chart       (unpaid rent over N months)
- property_comparison_table      (units side-by-side)
- lease_timeline_diagram         (signing -> rent-start -> renewal -> end)
- maintenance_case_flow_diagram  (reported -> triaged -> assigned -> resolved)
- five_ps_tenancy_risk_wheel     (Payment / Property / Purpose / Person / Protection)
Do NOT repeat the same block type twice in a row.
`;

const PRACTICE_MODE = `
### PRACTICE MODE
After demonstrating, ASK the learner a scenario question and wait.
Do not immediately reveal the answer. Wait for their input.
`;

const CLOSING = `
### CLOSING REMARKS
End with a short CHECK question or "think about it" prompt.
Never close with a lecture. Always close with an interaction.
`;

function buildViolationWarning(
  lastResponseParagraphCount?: number,
  lastResponseHadBlock?: boolean,
  consecutiveLectureCount?: number,
): string {
  const warnings: string[] = [];
  if ((lastResponseParagraphCount ?? 0) > 3 && !lastResponseHadBlock) {
    warnings.push(
      `Your last response was ${lastResponseParagraphCount} paragraphs long with NO visual. Drop a <ui_block> in this turn.`,
    );
  }
  if ((consecutiveLectureCount ?? 0) >= 2) {
    warnings.push(
      `You have lectured ${consecutiveLectureCount} turns in a row without a visual. Next turn MUST include a <ui_block>.`,
    );
  }
  if (warnings.length === 0) return '';
  return `\n### PRIOR VIOLATIONS\n${warnings.map((w) => `- ${w}`).join('\n')}\n`;
}

export function buildTeachingMethodologyLayer(
  lastResponseParagraphCount?: number,
  lastResponseHadBlock?: boolean,
  consecutiveLectureCount?: number,
): string {
  return [
    HEADER,
    CYCLE,
    LECTURE_LIMIT,
    ARTIFACT_VARIETY,
    PRACTICE_MODE,
    CLOSING,
    buildViolationWarning(lastResponseParagraphCount, lastResponseHadBlock, consecutiveLectureCount),
  ]
    .filter((s) => s.trim().length > 0)
    .join('\n\n');
}
