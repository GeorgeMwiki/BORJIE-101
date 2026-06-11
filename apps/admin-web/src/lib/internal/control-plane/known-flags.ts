/**
 * Curated capability / kill-switch power-flag catalog the control plane can
 * read + toggle. These are PLATFORM capability flags — never sovereign rails
 * (the gateway rejects any `killswitch_*` / `sovereign*` / `four_eye*` /
 * `policy_rollout*` write with 403, so they are intentionally absent here).
 *
 * The gateway's `/powers` read takes an explicit `flags=` list, so the UI must
 * name the flags it manages. Operators may also add an ad-hoc snake_case flag
 * via the inline input; this list is the curated starting set, not a hard cap.
 */
export interface KnownFlag {
  readonly flag: string;
  readonly label: string;
  readonly description: string;
}

export const KNOWN_POWER_FLAGS: ReadonlyArray<KnownFlag> = [
  {
    flag: 'ensemble_routing_enabled',
    label: 'Ensemble routing',
    description: 'Allow multi-model ensemble answers (cost-aware; N members = N x cost).',
  },
  {
    flag: 'proactive_hints_enabled',
    label: 'Proactive hints',
    description: 'Surface anticipatory ProactiveHint suggestions in chat surfaces.',
  },
  {
    flag: 'voice_realtime_enabled',
    label: 'Realtime voice',
    description: 'Enable the selectable OpenAI-Realtime voice path.',
  },
  {
    flag: 'media_generation_enabled',
    label: 'Media generation',
    description: 'Allow the media-engine document / video / GIF generation tools.',
  },
  {
    flag: 'reflexion_sleep_enabled',
    label: 'Reflexion sleep-consolidation',
    description: 'Run the nightly sleep-consolidation reflexion pass.',
  },
  {
    flag: 'semantic_cache_enabled',
    label: 'Semantic cache',
    description: 'Serve cache-hits from the semantic response cache before inference.',
  },
] as const;

export const KNOWN_FLAG_NAMES: ReadonlyArray<string> = KNOWN_POWER_FLAGS.map(
  (f) => f.flag,
);
