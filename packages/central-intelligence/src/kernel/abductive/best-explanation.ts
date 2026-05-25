/**
 * Abductive inference — best-explanation chooser.
 *
 * When the brain is staring at 2+ candidate explanations for the same
 * observation set (three leases match a tenant id, two property records
 * share a postcode, several maintenance tickets could be the one the
 * user just mentioned), it must NOT silently pick one and present it as
 * fact. The human move is to name the most likely explanation, hedge,
 * and surface the alternatives.
 *
 * `inferBestExplanation(facts, candidates)` returns:
 *   - `leading`     — the highest-posterior hypothesis with a hedged
 *                     phrasing block ready for the prompt
 *   - `alternatives`— the remaining candidates, sorted descending, each
 *                     carrying their relative weight
 *   - `why`         — a one-sentence rationale that names the
 *                     dominating prior and acknowledges the ambiguity
 *
 * Posterior = prior (the caller supplies; e.g. recency, exact-match
 * count, geographic distance, etc.). The module is intentionally not
 * Bayesian — kernel callers already produce a calibrated prior; this
 * module's job is to rank, hedge the language, and surface the ranking
 * to the sensor. The "model thinks" not "model claims" pattern.
 *
 * Pure / dependency-free so the kernel can call this synchronously.
 */

/**
 * A candidate explanation supplied by the caller. `prior` is the
 * relative weight in [0, +∞); the module normalises across the set so
 * callers can pass raw counts, recency scores, or already-normalised
 * probabilities without rescaling.
 */
export interface AbductiveCandidate {
  readonly hypothesis: string;
  readonly prior: number;
  /** Optional caller-supplied context for the rationale. */
  readonly evidence?: string;
}

export interface AbductiveRankedCandidate {
  readonly hypothesis: string;
  /** Posterior weight in [0,1], normalised across the candidate set. */
  readonly posterior: number;
  readonly evidence?: string;
}

export interface AbductiveInference {
  readonly leading: AbductiveRankedCandidate;
  readonly alternatives: ReadonlyArray<AbductiveRankedCandidate>;
  readonly why: string;
  /**
   * Pre-rendered hedged language fragment the kernel can mix into the
   * system prompt: "Most likely <leading.hypothesis> (confidence ~XX%);
   * also possible: <alts>." Always uses hedging verbs ("most likely",
   * "I believe", "based on what I see") — never assertive.
   */
  readonly hedgedFragment: string;
}

const EPSILON = 1e-9;

/**
 * Rank candidate hypotheses by their priors and emit a hedged prompt
 * fragment. Throws on an empty candidate list (the caller must own the
 * "no hypothesis" path — it's a different conversation).
 */
export function inferBestExplanation(
  facts: ReadonlyArray<string>,
  candidates: ReadonlyArray<AbductiveCandidate>,
): AbductiveInference {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('inferBestExplanation requires at least one candidate');
  }

  // Normalise non-negative priors to a [0,1] posterior. Zero-prior
  // candidates are kept but receive the residual weight after positive
  // candidates absorb their share, so a "0 + 0 + 0" set still ranks
  // alphabetically rather than dividing-by-zero.
  const positivePriors = candidates.filter((c) => c.prior > 0);
  const totalPositive = positivePriors.reduce((s, c) => s + c.prior, 0);

  const ranked: AbductiveRankedCandidate[] = candidates.map((c) => {
    const posterior =
      totalPositive > EPSILON
        ? Math.max(0, c.prior) / totalPositive
        : 1 / candidates.length;
    const out: AbductiveRankedCandidate = {
      hypothesis: c.hypothesis,
      posterior,
    };
    if (c.evidence !== undefined) {
      return { ...out, evidence: c.evidence };
    }
    return out;
  });

  // Descending sort by posterior; tiebreak alphabetically so the
  // output is deterministic for snapshot tests.
  const sorted = [...ranked].sort((a, b) => {
    if (b.posterior !== a.posterior) return b.posterior - a.posterior;
    return a.hypothesis.localeCompare(b.hypothesis);
  });

  const leading = sorted[0]!;
  const alternatives = sorted.slice(1);

  const why = buildWhy(leading, alternatives, facts);
  const hedgedFragment = buildHedgedFragment(leading, alternatives);

  return { leading, alternatives, why, hedgedFragment };
}

function buildWhy(
  leading: AbductiveRankedCandidate,
  alternatives: ReadonlyArray<AbductiveRankedCandidate>,
  facts: ReadonlyArray<string>,
): string {
  const confidencePct = Math.round(leading.posterior * 100);
  const factsPart =
    facts.length > 0
      ? `Given ${facts.length} fact${facts.length === 1 ? '' : 's'} on the table, `
      : '';
  if (alternatives.length === 0) {
    return `${factsPart}I see one explanation that fits: "${leading.hypothesis}" (~${confidencePct}% prior weight). I'll name it as a hypothesis, not a fact.`;
  }
  const closest = alternatives[0]!;
  const margin = Math.round((leading.posterior - closest.posterior) * 100);
  const marginPhrase =
    margin <= 5
      ? 'a very narrow margin'
      : margin <= 15
        ? 'a slim margin'
        : 'a clear margin';
  return `${factsPart}"${leading.hypothesis}" leads with ~${confidencePct}% prior weight, by ${marginPhrase} over ${alternatives.length} other candidate${alternatives.length === 1 ? '' : 's'}. I'll flag it as my best guess and surface the alternatives.`;
}

function buildHedgedFragment(
  leading: AbductiveRankedCandidate,
  alternatives: ReadonlyArray<AbductiveRankedCandidate>,
): string {
  const lead = `Most likely: ${leading.hypothesis} (I estimate ~${Math.round(
    leading.posterior * 100,
  )}% based on what I see).`;
  if (alternatives.length === 0) return lead;
  const altList = alternatives
    .slice(0, 3)
    .map(
      (a) => `${a.hypothesis} (~${Math.round(a.posterior * 100)}%)`,
    )
    .join('; ');
  return `${lead} Also possible: ${altList}. I'll flag the guess explicitly rather than commit to one silently.`;
}
