export * from './types.js';
export { actionCorrectness } from './action-correctness.js';
export { escalationCorrectness } from './escalation-correctness.js';
export { communicationQuality } from './communication-quality.js';
export { costEfficiency } from './cost-efficiency.js';

import { actionCorrectness } from './action-correctness.js';
import { escalationCorrectness } from './escalation-correctness.js';
import { communicationQuality } from './communication-quality.js';
import { costEfficiency } from './cost-efficiency.js';
import type { Scorer } from './types.js';

export const ALL_SCORERS: Readonly<Record<string, Scorer>> = Object.freeze({
  'action-correctness': actionCorrectness,
  'escalation-correctness': escalationCorrectness,
  'communication-quality': communicationQuality,
  'cost-efficiency': costEfficiency,
});
