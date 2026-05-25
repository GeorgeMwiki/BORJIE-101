/**
 * SVG Primitives (estate-management edition)
 *
 * Starter primitives the AI can compose from when generating dynamic_visual
 * SVG on the blackboard. NOT limits: the AI may compose any SVG it needs.
 */

export const SVG_COLORS = {
  positive: '#22c55e',
  negative: '#ef4444',
  neutral: '#3b82f6',
  warning: '#f59e0b',
  muted: '#94a3b8',
  background: '#f8fafc',
  text: '#1e293b',
  textLight: '#64748b',
  border: '#e2e8f0',
  accent1: '#8b5cf6',
  accent2: '#06b6d4',
  accent3: '#ec4899',
} as const;

/** Prompt text injected into AI system prompt so SVG output is consistent. */
export const SVG_PRIMITIVES_PROMPT = `
## SVG BLACKBOARD PRIMITIVES (ESTATE-MANAGEMENT)

Compose from these when drawing on the blackboard. Canvas = 500x300.

### BAR CHART — comparing rent vs income, arrears growth, unit occupancy
<rect x="X" y="Y" width="60" height="H" rx="4" fill="#3b82f6" opacity="0.85"/>
<text x="X+30" y="Y-8" text-anchor="middle" font-size="11" fill="#1e293b">LABEL</text>

### BALANCE SCALE — rent vs income affordability, 5 Ps trade-offs
<polygon points="250,200 230,260 270,260" fill="#94a3b8" opacity="0.3"/>
<rect x="60"  y="170" width="120" height="50" rx="8" fill="#22c55e" opacity="0.15" stroke="#22c55e"/>
<rect x="320" y="190" width="120" height="50" rx="8" fill="#ef4444" opacity="0.15" stroke="#ef4444"/>

### PENTAGON / 5 Ps RADAR — Payment history, Property fit, Purpose, Person, Protection

### TIMELINE — lease signing, rent start, renewal window, lease end
Use filled circles for completed events, outlined for upcoming.

### FLOW DIAGRAM — maintenance case: Reported -> Triaged -> Assigned -> Resolved
Use arrows with stroke="#3b82f6" stroke-width="2" marker-end="url(#arrow)".
`;

/** Return a neutral SVG canvas wrapper so callers can inject content safely. */
export function wrapSvg(inner: string, viewBox = '0 0 500 300'): string {
  return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">${inner}</svg>`;
}
