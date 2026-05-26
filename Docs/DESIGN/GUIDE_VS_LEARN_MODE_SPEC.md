# Guide vs Learn Mode — Design Specification

> Wave 19B. Pillar A of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md).
> Same content, two voices. The owner toggles per-surface.
>
> **Cross-links:** [`HOME_DASHBOARD_STANDARD.md`](./HOME_DASHBOARD_STANDARD.md),
> [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md),
> [`DOCUMENT_COMPOSITION_SPEC.md`](./DOCUMENT_COMPOSITION_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Users can toggle between GUIDE and LEARN."

---

## 2. The Thesis — One Persona, Two Voices

A new owner who has never filed a Tumemadini Q2 return needs the
*doing* voice: *"I'll prepare the return; here's the draft; approve to
file."* A seasoned mining-house CFO who has filed 28 Q2 returns needs
the *teaching* voice when they want to skill-up their junior staff:
*"Walk through how I'm computing the royalty rate. Look at the BoT
gold-window rate from yesterday — see how it propagates into clause
4.2? Try the next calculation yourself; I'll check."*

The founder's directive: every user, every surface, must let the human
flip between **GUIDE mode** (let me do this for you, you approve) and
**LEARN mode** (let me teach you how, you do it). Same Mr. Mwikila,
same context, same data, same regulator citations — *different voice,
different scaffolding, different goal-of-the-turn*.

The 2026 educational-AI literature gives us the design vocabulary.
[Khan Academy's Khanmigo](https://callsphere.ai/blog/ai-agents-education-khan-academy-duolingo-autonomous-tutoring)
shipped to ~50M students in 2026 with a Socratic scaffolding model:
*never deliver the answer; deliver the next question that gets the
student to the answer themselves*. The educational frame applies
directly: LEARN mode in Borjie is Khanmigo for adult professionals
running a mining operation. GUIDE mode is the inverse — Mr. Mwikila
takes over the cognitive load and the human approves. The toggle is
the consent surface.

---

## 3. Architecture — the mode-shift adapter

```
                    User input on any tab
                              │
                              ▼
                ┌──────────────────────────┐
                │ Tab + User Mode Resolver │
                │ (resolves to GUIDE or    │
                │  LEARN per surface)      │
                └─────────────┬────────────┘
                              │
                              ▼
              ┌──────────────────────────────┐
              │ compose_anything_v1 (18Q)    │
              │ — same dispatcher, same data │
              │ — different voice template   │
              └──────────────┬───────────────┘
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
        ┌──────────────┐         ┌──────────────┐
        │ GUIDE VOICE  │         │ LEARN VOICE  │
        │ "I prepared  │         │ "Let's walk  │
        │  the return; │         │  through it; │
        │  approve to  │         │  what would  │
        │  file."      │         │  you input?" │
        └──────────────┘         └──────────────┘
```

The same factual content (the same parcels, the same royalty rate, the
same regulatory citations) is rendered through one of two **VoiceTemplates**.
The user toggle is a server-side preference written to
`user_mode_preferences` per `(user_id, surface_id)` tuple.

---

## 4. Mode definitions

### 4.1 GUIDE mode

**Goal of the turn:** the artifact gets shipped with minimal cognitive
load on the user.

**Voice characteristics:**

- First person plural with action verbs: *"I've prepared the Q2
  return; I'm proposing we file Friday."*
- Recommendations and tradeoffs front-loaded; user reviews and
  approves.
- Sentences ≤25 words on average. Inline citations as superscripts.
- Decisive framing: *"My recommendation is X; the alternative Y
  costs more in working capital; here's the approve button."*
- No Socratic questions unless the cognitive engine returns
  `sufficiency: 'needs_clarification'`.

**Output structure:** action-first. The artifact and the approve
button are at the top; the explanatory body is collapsed by default
behind a "show reasoning" affordance.

### 4.2 LEARN mode

**Goal of the turn:** the user understands the *why* and could produce
the artifact themselves next time.

**Voice characteristics:**

- Socratic, scaffolded: *"Before we file, what does the BoT
  gold-window rate from yesterday imply for clause 4.2? Take a guess;
  I'll show you the calculation."*
- Stepwise hints, never the final answer first. Khanmigo's discipline:
  *"deliver the next question, not the answer."*
- Sentences can be longer (≤40 words avg) to carry the explanation.
- Comparative + causal framing: *"Last quarter you filed before the
  rate stabilised — that's why the variance was 3.1%; this time we
  wait for the close."*

**Output structure:** explanation-first. The artifact and the
approve button are at the bottom, behind a "I understand — show me the
draft" affordance, so the user is not tempted to skip to the answer.

---

## 5. Per-surface mode preference

The toggle is **per-surface**, not global. The same user can be in
GUIDE mode on the Tumemadini-filing tab (they've done 30 of these and
don't need the explanation) and in LEARN mode on the FX-hedging tab
(new capability, want to learn). The preference is keyed:

```typescript
export interface UserModePreference {
  readonly user_id: string;
  readonly surface_id: string;        // 'tab:tumemadini_filing' | 'tab:fx_hedge' | etc.
  readonly mode: 'guide' | 'learn';
  readonly last_changed_at: string;
  readonly auto_suggested: boolean;   // true if system suggested based on mastery
}
```

Defaults at first encounter use the **mastery tier heuristic** (§7).
Once a user changes the mode explicitly, the preference sticks.

---

## 6. Mastery tier consideration — the default chooser

Existing `packages/chat-ui/src/lib/user-mastery` tracks a mastery
score per surface per user. The heuristic for first-encounter default:

| Mastery score | Default mode |
|---|---|
| 0.0 – 0.3 (novice) | LEARN (the user benefits from scaffolding) |
| 0.3 – 0.7 (intermediate) | LEARN (still gaining muscle memory) |
| 0.7 – 0.9 (advanced) | GUIDE (let me execute; you approve) |
| 0.9 – 1.0 (expert) | GUIDE (the user could supervise *me* on this one) |

When a user explicitly toggles, the system stores `auto_suggested:
false` and never changes the mode again until the user does.

The default chooser can be overridden by an org-level admin policy.
Some organisations want all employees in LEARN mode for compliance
reasons (the audit trail then shows the human reasoning, not just the
AI output). The override key: `org_unit.policy.default_mode_override`.

---

## 7. Voice templates — per-capability

Each of the 5 atomic capabilities
([`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md)) ships
two voice templates:

| Capability | GUIDE template | LEARN template |
|---|---|---|
| `research_v1` | "Here's what I found; the top 3 implications are…" | "Let's research this together. What do you think the top implication is? Here's the data — try it." |
| `compose_tab_v1` | "I've spawned a tab with your data pre-filled; you can submit." | "Let's build this tab. What fields would you need to capture? Here are mine — compare." |
| `compose_doc_v1` | "Here's the doc draft; approve to publish." | "Walk through the doc with me. Section by section — try the first paragraph; I'll critique." |
| `compose_media_v1` | "Here's the image; here's the alt text; ready to use." | "What's the visual story you want to tell? Here are 3 approaches I'd consider — pick one." |
| `compose_campaign_v1` | "Here's the 12-asset campaign; review and approve." | "Let's plan the campaign. What's the audience? What's the message? I'll guide; you decide each call." |

Voice templates live in `packages/persona-voice/src/templates/` (Phase
2 wave). They are JSON files; cite-validator runs over both templates
identically; both write the same audit-chain entries with the *only*
difference being `voice_mode` in the metadata.

---

## 8. The toggle UX

The toggle lives on every tab in a consistent location: top-right
corner of the chat input, a chip with two segments — `GUIDE` and
`LEARN`. The current mode is filled; the other is outlined. One tap
switches; the next assistant message uses the new voice.

The chip on first encounter shows a subtle pulse animation drawing
attention to the toggle (only if mastery ≥ 0.6 — novices should
discover the chip naturally rather than be pushed). Existing
[`HOME_DASHBOARD_STANDARD.md`](./HOME_DASHBOARD_STANDARD.md) Home
tab gets a global default chooser in settings; per-tab chips override.

---

## 9. Operating contract — TypeScript

```typescript
export interface VoiceTemplate {
  readonly id: string;                              // 'tumemadini_filing.guide.v1'
  readonly capability: CapabilityId;
  readonly mode: 'guide' | 'learn';
  readonly system_prompt_addendum: string;          // injected into the system prompt
  readonly few_shot_examples: ReadonlyArray<VoiceExample>;
  readonly anti_patterns: ReadonlyArray<string>;    // "do not give the answer first" (learn)
  readonly version: string;
}

export interface VoiceModeResolver {
  readonly resolveForTurn: (params: {
    user_id: string;
    surface_id: string;
    capability: CapabilityId;
  }) => Promise<{ mode: 'guide' | 'learn'; auto_suggested: boolean }>;
}

export interface ModeToggleAction {
  readonly user_id: string;
  readonly surface_id: string;
  readonly new_mode: 'guide' | 'learn';
  readonly previous_mode: 'guide' | 'learn';
  readonly explicit: boolean;                       // false if system-changed via org-policy
}
```

Schema (migration `0034_daily_followup.sql` — co-locates with the
follow-up tables since both ride the same per-user infrastructure):

```sql
CREATE TABLE user_mode_preferences (
  user_id UUID NOT NULL,
  surface_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('guide', 'learn')),
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  auto_suggested BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, surface_id)
);
CREATE INDEX idx_ump_user ON user_mode_preferences(user_id);

CREATE TABLE voice_templates (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('guide', 'learn')),
  system_prompt_addendum TEXT NOT NULL,
  few_shot_examples JSONB NOT NULL DEFAULT '[]',
  anti_patterns JSONB NOT NULL DEFAULT '[]',
  version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 10. SOTA landscape — 2026 references

- **Khanmigo Tutor Agent** ([CallSphere overview, 2026](https://callsphere.ai/blog/ai-agents-education-khan-academy-duolingo-autonomous-tutoring))
  — agent that "personalises curriculum, pace, and teaching style in
  real-time", scaled to 50M students. The educational template Borjie
  borrows for LEARN mode.
- **LinguaLive AI Tutor Comparison 2026** ([guide](https://www.lingualive.ai/blog/ai-tutor-complete-guide))
  — 7 types of AI tutors compared; consistent finding: Socratic
  scaffolding ≫ direct-answer for retention.
- **Microsoft Copilot evolution** ([Windows News, May 2026](https://windowsnews.ai/article/microsofts-2026-copilot-evolution-from-drafting-assistant-to-governed-ai-execution-layer.409373))
  — Copilot is moving "from drafting assistant to active execution
  layer". The Borjie split is dual-mode: GUIDE = execution layer,
  LEARN = drafting-as-tutor.

---

## 11. How this connects to existing Borjie architecture

- **Cognitive engine** [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md):
  the 6 disciplines run identically in both modes. Mode affects voice,
  not reasoning. The reasoning trace, citation set, and confidence
  label are mode-agnostic.
- **Unified cognitive memory** [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md):
  both modes read and write the same memory cells. LEARN-mode turns
  may *generate more* memory cells (the user's reasoning steps become
  observation-class cells).
- **Anticipatory UX** [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md):
  spawn proposals adapt to mode — GUIDE-mode proposals come pre-
  filled; LEARN-mode proposals come blank with hints.
- **Home/Dashboard** [`HOME_DASHBOARD_STANDARD.md`](./HOME_DASHBOARD_STANDARD.md):
  the Home chat surface obeys the mode toggle by default; Dashboard
  cockpit cards show mode-aware tooltips.

---

## 12. Anti-patterns

1. **Lecturing a veteran.** A user who has filed 28 Tumemadini returns
   getting Socratic scaffolding on Q2 #29 is friction. The mastery
   tier heuristic should default them to GUIDE; if they explicitly
   chose LEARN, respect that — but if mastery ≥ 0.85 and the user has
   not toggled in 90 days, surface a subtle hint: *"You're in LEARN
   mode here — want to switch to GUIDE? Tap the chip."*
2. **Doing-for a learner.** A user who picked LEARN mode but gets a
   completed draft anyway has been over-served. The mode toggle MUST
   be respected. The compose layer MUST not bypass the LEARN voice
   template even if the GUIDE output is "ready".
3. **Mode flip-flop without context.** If the user switches mode
   mid-conversation, the next turn must acknowledge the switch
   explicitly: *"Switching to GUIDE — I'll handle this. Tap approve
   when ready."* Silent mode change confuses the human.
4. **Org-policy override without notice.** If the admin enables a
   policy that flips a user from GUIDE to LEARN org-wide, the user
   sees a notification: *"Your manager set LEARN as the default for
   this surface. You can toggle back per-tab."*
5. **Mode-independent metrics.** The friction-meter from
   [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md) MUST separate
   GUIDE-mode signals from LEARN-mode signals. A 30-second LEARN-mode
   turn is success; a 30-second GUIDE-mode turn is friction.

---

## 13. Phase 2 implementation map

- **New package** `packages/persona-voice/` (≈600 LOC):
  - `voice-templates/` (JSON template files per capability + mode).
  - `voice-mode-resolver.ts` (the (user, surface) → mode lookup).
  - `voice-renderer.ts` (template injection into system prompt).
- **Migration** `0034_daily_followup.sql` adds the two tables (see §9).
- **API routes:**
  - `GET  /api/v1/persona-voice/mode/:user_id/:surface_id`
  - `POST /api/v1/persona-voice/mode` — write toggle.
- **chat-ui changes:**
  - `packages/chat-ui/src/mode-toggle/ModeChip.tsx` — the segmented chip.
  - Persistent ModeChip on every tab; reads the resolver on mount.
- **eval coverage:** 2 LEARN-vs-GUIDE eval pairs per capability — 10
  total — to ensure voice templates are distinguishable and
  reasoning is preserved.
- **Estimated effort:** 2 weeks for one engineer (most reuse from
  existing persona kernel).

---

## 14. Cross-reference to siblings

- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md)
  §2.1 — Pillar A.
- Daily user follow-up: [`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md)
  — the daily check-in obeys the user's preferred mode.
- 24/7 work cycle: [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md)
  — overnight drafts use GUIDE voice by default since they will be
  reviewed not learned-from.
- Tab-as-loop: [`TAB_AS_LOOP_SPEC.md`](./TAB_AS_LOOP_SPEC.md) —
  per-tab friction metering segregated by mode.
- Information synthesis: [`INFORMATION_SYNTHESIS_SOTA_SPEC.md`](./INFORMATION_SYNTHESIS_SOTA_SPEC.md)
  — LEARN-mode synthesis outputs include explanatory annotations;
  GUIDE-mode outputs are terse.

---

*The toggle is the consent surface. The same data, the same persona,
two different shapes of cognitive load on the human — chosen by the
human, every tab, every turn.*

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
