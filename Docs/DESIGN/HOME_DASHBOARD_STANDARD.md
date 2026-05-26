# Home / Dashboard — Two-Tab Standard for Every Portal + App

> Wave 18W spec — Mr. Mwikila is the front door. Every Borjie surface
> opens to a full-screen chat with the appropriate persona. The
> traditional workspace (cards, charts, tables) lives in a secondary
> Dashboard tab. Floating chat persists everywhere else.

Status: design-spec. No runtime side-effects in this wave beyond a NEW
`packages/chat-ui/src/home-shell/` reference component scaffold. Per-app
wiring lands in a follow-up implementation wave after the C4-finisher
strict-flags milestone closes.

Brand: Borjie. Persona: Mr. Mwikila (Managing Director).

Cross-links:
- `Docs/DESIGN/CAPABILITIES_UNIFICATION.md` — Wave 18Q. The persona that
  Home resolves to is the single unified creator surface (`compose_anything_v1`)
  for owners and admins.
- `Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md` — the DNA the persona must honour.
- `Docs/MR_MWIKILA_COVERAGE.md` — the >90% chat-driven action target the
  Home tab is designed to make discoverable.
- 18V sibling — JUNIOR_ARCHITECTURE_SPEC (forthcoming) — defines the
  `resolveAgentForUser(role, surface) -> Persona` contract Home consumes.

---

## 1. Vision

The founder is unambiguous:

> "We will have Home and Dashboard tabs, where Home is default full-screen
> chat interface. This is standard for all portals and apps."

Reframed for engineering: **the chat is the primary product surface**, not
a side-panel. Mr. Mwikila — or the appropriate scoped junior — is the
first thing the user sees. The user can describe what they want in
natural language and the persona dispatches to the underlying skills,
tools, and tab-spawn proposals. The cockpit-style workspace that has been
the historical default on web (the 10-card grid in owner-web, the platform
overview in admin-web, the marketplace grid in buyer-mobile, the shift
queue in workforce-mobile) does not disappear — it moves one tab over,
into a tab called **Dashboard**. From Day One every portal and every app
must obey this two-tab structure.

The MD-first vision relies on this. If the user has to click "Ask Borjie"
to find Mr. Mwikila, then Mr. Mwikila is a feature. If the user lands
inside a full-screen conversation, then Mr. Mwikila is the product.

---

## 2. The two-tab standard

Every Borjie portal (owner-web, admin-web, marketing) and every Borjie
app (workforce-mobile, buyer-mobile) MUST expose exactly two top-level
tabs at the root of the navigation:

- **Home tab** — the default route (`/`). Renders the new full-screen
  `HomeShell` component. Persona is resolved by the user's role via
  `resolveAgentForUser(role, surface)` from `@borjie/agent-platform`'s
  junior-contract module (18V). On desktop and mobile the chat takes
  the whole viewport. Conversation continuity is preserved across
  sessions (server-side `conversation_id`). An optional left-rail
  (collapsible) shows chat history. An optional right-rail surfaces
  the latest `NeedSpawnBanner` proposals so the user can see proactive
  tab proposals without leaving the conversation.

- **Dashboard tab** — the secondary route (`/dashboard`). The
  traditional workspace: cards, charts, tables, KPIs. Every per-app
  cockpit lives here — owner-web's 10 cockpit cards, admin-web's
  platform overview, workforce-mobile's shift queue, buyer-mobile's
  saved searches. The Dashboard tab is where the rich generative-UI
  surfaces (artifacts, charts, blackboards) render when the user
  wants to dwell on a result. The Dashboard tab ALWAYS includes the
  floating chat widget so the user is never more than one click from
  Mr. Mwikila.

Tabs beyond Home and Dashboard (e.g. owner-web `/sites`, admin-web
`/control-tower`, buyer-mobile `/bids`) are allowed but they are
secondary navigation — they are never the default landing route.

---

## 3. Persona routing per surface

| Surface | User role | Home persona | Floating chat in Dashboard? |
|---|---|---|---|
| owner-web | owner | Mr. Mwikila (full MD) | yes |
| owner-web | admin (impersonating) | Mr. Mwikila (full MD) | yes |
| admin-web | admin | Mr. Mwikila (full MD) | yes |
| marketing | public | Mr. Mwikila (public mode) | yes |
| workforce-mobile | site_manager | Mr. Mwikila for cross-domain; scoped junior for in-domain | yes |
| workforce-mobile | worker | Safety / comms / shift junior | yes |
| buyer-mobile | buyer | Marketplace / KYB junior | yes |
| BossNyumba owner-portal | owner | Mr. Mwikila (full MD) | yes |
| BossNyumba admin-portal | admin | Mr. Mwikila (full MD) | yes |
| BossNyumba customer-app | tenant | Tenant / lease junior | yes |
| BossNyumba estate-manager-app | site_manager | Estate-ops junior | yes |

Persona resolution is a single function call. The Home tab MUST NOT
hardcode persona — it consumes the resolver. This guarantees that as
juniors evolve (and as 18V lands), Home automatically routes the right
user to the right persona without per-app updates.

---

## 4. The HomeShell component contract

```typescript
export interface HomeShellProps {
  readonly user_role: 'owner' | 'admin' | 'site_manager' | 'worker' | 'buyer' | 'public';
  readonly tenant_id: string;
  readonly user_id: string;
  readonly initial_persona_override?: string;     // for explicit "talk to X" links
  readonly api_base_url: string;
  readonly getAccessToken?: () => Promise<string | null>;
  readonly variant: 'full_screen' | 'split_with_history';
  readonly enable_proactive_banners: boolean;
  readonly enable_dashboard_link: boolean;        // shows "Open Dashboard" CTA in header
  readonly initial_language: 'en' | 'sw' | 'fr';
}

export interface HomeShellState {
  readonly resolved_agent: { id: string; display_name: string; title: string };
  readonly conversation_id: string;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly streaming: boolean;
  readonly pending_proposals: ReadonlyArray<ProactiveProposal>;
}
```

Renderer-pure. Network calls are funneled through props (`api_base_url`,
`getAccessToken`). The component is mounted by each app's root route.
HomeShell composes existing chat-ui primitives — it MUST NOT reimplement
chat streaming, message bubbles, or evidence chips. Instead it imports
`BorjieChatPanel`, `MasteryGate`, `LearnedShortcutsPanel`, and
`NeedSpawnBanner` from the existing `@borjie/chat-ui` exports.

---

## 5. The Dashboard tab contract

The Dashboard tab is per-app — owner-web's dashboard is not admin-web's
dashboard. The shared contract is minimal:

- Dashboard pages MUST render the `FloatingAskBorjie` widget so the
  user can summon Mr. Mwikila from any cockpit screen.
- Dashboard navigation MUST NEVER hide chat access — the floating
  bubble is always visible, never gated by a feature flag, never moved
  off-screen by a modal.
- Dashboard pages MAY use the shared `MasteryGate` and
  `LearnedShortcutsPanel` components for progressive disclosure.
- Dashboard pages MAY render `ChatArtifactStream` to show artifacts
  produced by the conversation that the user has chosen to pin.

The contract is intentionally light — apps are free to keep their
existing cockpit visuals. The two-tab standard is a layout invariant,
not a redesign mandate.

---

## 6. Routing strategy per app

```
Borjie owner-web:
  /                  -> Home (full-screen chat with Mr. Mwikila)
  /dashboard         -> Dashboard (existing 10-card cockpit, KPIs, mine-grade widgets)
  /sites             -> existing
  /licences          -> existing
  ... all existing routes preserved; only `/` is rebound to Home.

Borjie admin-web:
  /                  -> Home (Mr. Mwikila, admin view)
  /dashboard         -> existing platform overview
  ... existing routes preserved.

Borjie marketing:
  /                  -> existing landing page (NOT changed; landing has its own logic)
  /chat              -> Home (Mr. Mwikila, public mode) [NEW explicit route]
  ... existing routes preserved.
  Note: floating chat already lives on the landing page. The /chat route
  is a deep-link target — e.g. for blog CTAs, social posts, and demo links.

Borjie workforce-mobile (Expo):
  / (root tab)       -> Home (resolved junior based on role)
  /dashboard         -> Dashboard (shift queue, incidents, payslip)

Borjie buyer-mobile (Expo):
  / (root tab)       -> Home (Marketplace / KYB junior)
  /dashboard         -> Dashboard (saved searches, bids, settled deals)
```

The same pattern applies to every BossNyumba app — see the BossNyumba
port of this spec.

---

## 7. Migration plan (Phase 2)

| App | New routes | Modifications to existing |
|---|---|---|
| owner-web | `/` (rebound to Home) | move existing root content into `/dashboard` |
| admin-web | `/` (rebound to Home) | move existing root content into `/dashboard` |
| marketing | `/chat` (new) | none — landing page stays at `/` |
| workforce-mobile | `/` (rebound to Home) | move existing root tab into `/dashboard` |
| buyer-mobile | `/` (rebound to Home) | move existing root tab into `/dashboard` |
| BossNyumba owner-portal | `/` (rebound to Home) | move existing root content into `/dashboard` |
| BossNyumba admin-portal | `/` (rebound to Home) | move existing root content into `/dashboard` |
| BossNyumba customer-app | `/` (rebound to Home) | move existing root content into `/dashboard` |
| BossNyumba estate-manager-app | `/` (rebound to Home) | move existing root content into `/dashboard` |
| BossNyumba tenant-portal | `/` (rebound to Home) | move existing root content into `/dashboard` |

This wave (18W-spec) does NOT modify any of these apps. The follow-up
wave (18W-impl) executes the migration.

---

## 8. HomeShell visual standard

- **Full-screen by default** — no app chrome at the top, no left
  navigation rail. The chat is the focus.
- **Subtle top-right corner** — persona name + title + "switch to
  Dashboard" button. The corner element is small but always visible so
  the user always knows who they are talking to and how to escape.
- **Subtle bottom-right corner** — persona avatar / branded gradient
  swatch. Used to reinforce identity, not as a CTA.
- **Composer at the bottom, sticky** — like every modern chat surface
  (ChatGPT, Claude, the existing BorjieChatPanel).
- **Conversation grows upward** — auto-scroll to bottom on new
  messages, respect `prefers-reduced-motion`.
- **Proactive banner** — `NeedSpawnBanner` docks to the top, under
  the persona header, when active. The user can dismiss without losing
  conversation state.
- **Mobile** — same layout. Composer handles iOS / Android keyboard
  inset correctly. The persona header collapses to a small chip.
- **Brand-DNA enforced** — every token consumed via the existing
  `borjie/no-non-token-style` ESLint rule. No raw hex, no off-brand
  fonts.

---

## 8.1. User-facing identity is locked

The user always sees ONE string in every chat / floating-widget / home-shell surface: **"Mr. Mwikila — Borjie's AI Mining Operations Manager"** (or the Boss Nyumba equivalent). No specialisation subtitle. No agent_id. Mr. Mwikila is presented as ONE intelligence — the user never knows whether a turn was handled by the root MD or a scoped specialisation.

The specialisation / agent_id / subtitle remain in the data model for:
- Backend routing (which specialisation logic the LLM draws from)
- Audit logs (`agent_turns` / `cognitive_turns` capture the agent_id)
- Owner admin panel (ONLY surface where internal names appear)

Reference: `packages/agent-platform/src/canonical-display.ts` defines the single source of truth (`MR_MWIKILA_CANONICAL_DISPLAY`).

The `ResolvedAgent` returned by `audience-resolver` still carries
`display_name` + `title` for the data model (audit + admin), but the
chat surface (`PersonaHeader`, `BorjieChatPanel` header,
`FloatingAskBorjie` label) sources its rendered text from
`MR_MWIKILA_CANONICAL_DISPLAY` — never from the resolver output.

---

## 9. Owner override

The owner (and any individual user) can configure "I prefer to open to
Dashboard" in settings. The default is Home. The preference is sticky
per-user, stored in `user_home_preferences` (see schema below). On
load, the app router reads the preference and redirects accordingly.
When the override is set, the user can still reach Home by clicking
the persona name in the top-right.

---

## 10. Anti-patterns

- Open the dashboard route by default for any role — MUST be Home.
- Show app chrome (top nav, left rail) on the Home tab — defeats the
  focus.
- Hide the persona header — the user must always know who is talking.
- Hide the "switch to Dashboard" affordance — the user must always
  have a clean escape into the workspace.
- Show floating chat with a different persona than the resolved one —
  per-surface consistency is mandatory. (E.g. a worker on
  workforce-mobile must not see "Mr. Mwikila" as the floating-chat
  persona while seeing "Safety junior" as the Home persona.)
- Mount HomeShell without `enable_proactive_banners` — owners must see
  proactive proposals; suppressing them weakens the MD-first vision.

---

## 11. Schema additions

```sql
CREATE TABLE user_home_preferences (
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  default_landing text NOT NULL DEFAULT 'home',         -- home|dashboard
  preferred_persona_override text,                       -- e.g. owner choosing to always talk to a specific junior
  collapsed_history_rail boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
```

Migration deferred to 18W-impl (Phase 2). The reference scaffold this
wave produces does NOT read this table — it accepts defaults via props.

---

## 12. Phase 2 implementation plan

The follow-up wave (18W-impl) will:

1. Wire `<HomeShell />` into each app's root route `/` (see table in §7).
2. Move existing root-page content to `/dashboard` per the migration
   table.
3. Add the `user_home_preferences` migration and the
   `GET/PUT /api/v1/user/home-preferences` endpoint.
4. Wire the redirect for users who have set `default_landing = 'dashboard'`.
5. Add an audit-chain entry for first-time Home visit
   (`event_type = 'home.first_visit'`) for telemetry.
6. Update the marketing site to add the `/chat` deep-link.
7. Update E2E specs in `e2e/tests/` to land on Home, not the cockpit.

The implementation wave depends on:

- C4-finisher (apps + services strict flags) — must land first so the
  apps' tsconfigs are in a stable state.
- 18V (JUNIOR_ARCHITECTURE_SPEC) — defines the
  `resolveAgentForUser(role, surface)` contract Home calls. Until 18V
  lands, the reference scaffold ships a stub resolver that returns
  Mr. Mwikila for owner/admin/public and a placeholder junior for
  worker/buyer/site_manager.
- 18Q (CAPABILITIES_UNIFICATION) — already landed. The persona Home
  resolves to is the unified-creator surface.

After all three land, the implementation wave is a one-week effort
across the 10 apps + the marketing site.

---

## 13. Acceptance criteria for 18W-spec

Complete when: this spec exists in both forks; `packages/chat-ui/src/home-shell/`
exists with the reference scaffold; `pnpm -F @borjie/chat-ui typecheck`
exits 0; `pnpm -F @borjie/chat-ui test` exits 0; no existing files modified.
Implementation criteria belong to 18W-impl.
