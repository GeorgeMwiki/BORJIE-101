/**
 * home-shell/types — public types for the full-screen Home tab.
 *
 * Spec: Docs/DESIGN/HOME_DASHBOARD_STANDARD.md (Wave 18W).
 *
 * HomeShell is the default landing surface across every Borjie portal
 * and app. The traditional cockpit lives in the secondary Dashboard
 * tab. These types are the public contract — apps wire HomeShell into
 * their root route by passing these props.
 *
 * NOTE: this module deliberately does NOT import React. It is the
 * shared type contract — components import from here.
 */

export type HomeShellUserRole =
  | 'owner'
  | 'admin'
  | 'site_manager'
  | 'worker'
  | 'buyer'
  | 'public';

export type HomeShellLanguage = 'en' | 'sw' | 'fr';

export type HomeShellVariant = 'full_screen' | 'split_with_history';

/**
 * The persona Home resolves to for a given (role, surface) pair. The
 * resolver is the bridge between HomeShell and the agent-platform
 * junior-contract (18V). Until 18V lands, the scaffold ships a stub
 * resolver — see `./resolve/audience-resolver.ts`.
 */
export interface ResolvedAgent {
  readonly id: string;
  readonly display_name: string;
  readonly title: string;
  /**
   * Which surface this agent is scoped to. Mirrors the persona
   * routing table in §3 of the spec.
   */
  readonly surface:
    | 'owner-web'
    | 'admin-web'
    | 'marketing'
    | 'workforce-mobile'
    | 'buyer-mobile'
    | 'borjie-owner-portal'
    | 'borjie-admin-portal'
    | 'borjie-customer-app'
    | 'borjie-estate-manager-app'
    | 'borjie-tenant-portal';
}

/**
 * Minimal chat-message shape Home renders. Apps may extend via the
 * Dashboard tab; the Home tab is intentionally lightweight.
 */
export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly created_at: string;
}

/**
 * Mirror of the NeedSpawnBanner proposal shape, kept loose so Home
 * can render without importing the banner's full TabSpawnProposal
 * type (which lives in `components/NeedSpawnBanner`).
 */
export interface ProactiveProposal {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly priority: 'low' | 'medium' | 'high';
}

export interface HomeShellProps {
  readonly user_role: HomeShellUserRole;
  readonly tenant_id: string;
  readonly user_id: string;
  /** For explicit "talk to X" deep-links — overrides role-based resolution. */
  readonly initial_persona_override?: string | undefined;
  readonly api_base_url: string;
  readonly getAccessToken?: (() => Promise<string | null>) | undefined;
  readonly variant: HomeShellVariant;
  readonly enable_proactive_banners: boolean;
  /** Shows the "Open Dashboard" CTA in the persona header. */
  readonly enable_dashboard_link: boolean;
  readonly initial_language: HomeShellLanguage;
  /**
   * Optional override for which surface this Home renders for. If
   * omitted, the resolver infers from user_role + a default mapping.
   */
  readonly surface_override?: ResolvedAgent['surface'] | undefined;
  /** Callback when the user clicks "Open Dashboard" in the header. */
  readonly onOpenDashboard?: (() => void) | undefined;
  /** Callback when the user accepts a NeedSpawnBanner proposal. */
  readonly onAcceptProposal?: ((proposal_id: string) => void) | undefined;
  /** Callback when the user dismisses a NeedSpawnBanner proposal. */
  readonly onDismissProposal?: ((proposal_id: string) => void) | undefined;
}

export interface HomeShellState {
  readonly resolved_agent: ResolvedAgent;
  readonly conversation_id: string;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly streaming: boolean;
  readonly pending_proposals: ReadonlyArray<ProactiveProposal>;
}
