/**
 * @borjie/litfin-port-data-infra/community-kernel — community-economy primitives.
 *
 * Ported from @litfin/community-kernel. LitFin's SACCO / VICOBA / KIKOBA
 * group-lending shapes map cleanly onto Borjie mining cooperatives
 * (CHAMA / cooperative society / pit syndicate) which are the dominant
 * artisanal-mining ownership form across Tanzania and the wider
 * pan-African belt.
 *
 * The cooperative kernel encodes:
 *  - Group identity: how members enrol, leave, and stake.
 *  - Pool economics: contributions, dividends, payout policy.
 *  - Group-level appraisal: collective credit-worthiness (for buyer
 *    advances + equipment leases against pooled production).
 *  - Peer simulation: three-voice debate (member / officer / sceptic)
 *    over a proposed pool action.
 *
 * Pure functions, side-effect-free. Consumers compose these with
 * Borjie's @borjie/ai-copilot persona stack to drive concrete
 * cooperative-side workflows (member onboarding, dividend
 * declaration, equipment-share approvals).
 */

export type CooperativeKind =
  | "chama"
  | "cooperative-society"
  | "pit-syndicate"
  | "sacco";

export interface CooperativeMember {
  readonly memberId: string;
  readonly displayName: string;
  readonly stakeUnits: number;
  readonly joinedAt: string; // ISO-8601
  readonly status: "active" | "suspended" | "exited";
}

export interface CooperativePoolSnapshot {
  readonly cooperativeId: string;
  readonly cooperativeKind: CooperativeKind;
  readonly tenantId: string;
  readonly memberCount: number;
  readonly activeMemberCount: number;
  readonly totalStakeUnits: number;
  readonly poolBalanceMinor: number;
  readonly currency: string;
  readonly lastDistributionAt?: string;
}

export interface CooperativeAggregationHealth {
  readonly cooperativeId: string;
  readonly groupCount: number;
  readonly activeMembers: number;
  readonly savingsMinor: number;
  readonly currency: string;
  readonly attendancePercent: number;
  readonly topContributors: ReadonlyArray<{
    readonly memberId: string;
    readonly contributionMinor: number;
  }>;
}

/**
 * Apportion a distribution across members weighted by their stake
 * units. Pure function; returns NEW objects (no mutation).
 *
 * Rounds DOWN per-member; the remainder accumulates in `residueMinor`
 * for the caller to handle (typically rolled forward to the next
 * distribution).
 */
export function apportionDistribution(args: {
  readonly poolMinor: number;
  readonly members: ReadonlyArray<CooperativeMember>;
}): {
  readonly perMember: ReadonlyArray<{
    readonly memberId: string;
    readonly amountMinor: number;
  }>;
  readonly residueMinor: number;
} {
  const active = args.members.filter((m) => m.status === "active");
  const totalStake = active.reduce((sum, m) => sum + m.stakeUnits, 0);
  if (totalStake === 0) {
    return { perMember: [], residueMinor: args.poolMinor };
  }
  const perMember = active.map((m) => ({
    memberId: m.memberId,
    amountMinor: Math.floor((args.poolMinor * m.stakeUnits) / totalStake),
  }));
  const distributed = perMember.reduce((sum, p) => sum + p.amountMinor, 0);
  return {
    perMember,
    residueMinor: args.poolMinor - distributed,
  };
}

/**
 * Three-voice debate primitive over a proposed cooperative action
 * (e.g. "advance 2M TZS to member X against next month's pit
 * production"). Each voice contributes a stance + rationale; the
 * caller can plug in LLM-backed voices or rule-based voices.
 *
 * Returns an immutable transcript; consumers project it into the
 * audit-chain for the related decision.
 */
export interface DebateVoice {
  readonly role: "member" | "officer" | "sceptic";
  readonly stance: "approve" | "reject" | "abstain";
  readonly rationale: string;
}

export interface DebateTranscript {
  readonly proposalId: string;
  readonly cooperativeId: string;
  readonly voices: ReadonlyArray<DebateVoice>;
  readonly verdict: "approve" | "reject" | "split";
  readonly recordedAt: string;
}

export function recordDebate(args: {
  readonly proposalId: string;
  readonly cooperativeId: string;
  readonly voices: ReadonlyArray<DebateVoice>;
}): DebateTranscript {
  const approvals = args.voices.filter((v) => v.stance === "approve").length;
  const rejections = args.voices.filter((v) => v.stance === "reject").length;
  const verdict: DebateTranscript["verdict"] =
    approvals > rejections
      ? "approve"
      : rejections > approvals
        ? "reject"
        : "split";
  return Object.freeze({
    proposalId: args.proposalId,
    cooperativeId: args.cooperativeId,
    voices: args.voices,
    verdict,
    recordedAt: new Date().toISOString(),
  });
}
