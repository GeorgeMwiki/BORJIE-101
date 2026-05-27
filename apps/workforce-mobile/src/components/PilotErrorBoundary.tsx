/**
 * Pilot error boundary — catches every uncaught React error in the
 * workforce-mobile tree, reports it via the pilot Sentry wrapper, and
 * shows a Swahili-first "tap to retry" surface so the pilot never sees
 * a white screen.
 *
 * Wiring
 * ──────
 * This component is NOT mounted by default — `_layout.tsx` is owned by
 * another in-flight agent (Agent 1 / Agent 3) and must not be edited
 * here. After their PRs land, wrap the root layout like so:
 *
 *   import { PilotErrorBoundary } from '../src/components/PilotErrorBoundary'
 *
 *   export default function RootLayout() {
 *     return (
 *       <PilotErrorBoundary>
 *         <Stack ... />
 *       </PilotErrorBoundary>
 *     )
 *   }
 *
 * Once mounted, every render-phase error in the tree will be caught,
 * captured, and the user shown a Swahili "Borjie imekutana na hitilafu.
 * Imerekodiwa. Bonyeza ili ujaribu tena." panel with a "Jaribu tena"
 * (try again) button.
 *
 * Immutability
 * ────────────
 * The boundary stores state via React's setState (always a new object
 * — never mutates in place). The `reset()` handler builds a fresh
 * cleared state, never mutates the previous one.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { captureError } from '../observability/sentry';
import { colors } from '../theme/colors';
import { fontSize, radius, spacing } from '../theme/spacing';

interface PilotErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Optional override for the headline shown when an error is captured.
   * Defaults to the Swahili-first pilot copy.
   */
  readonly fallbackTitle?: string;
  readonly fallbackBody?: string;
  readonly retryLabel?: string;
  /**
   * Optional override of the screen tag attached to the captured event.
   * Falls back to "root".
   */
  readonly screen?: string;
}

interface PilotErrorBoundaryState {
  readonly hasError: boolean;
  readonly errorMessage?: string;
}

const DEFAULT_TITLE = 'Borjie imekutana na hitilafu.';
const DEFAULT_BODY =
  'Imerekodiwa. Bonyeza ili ujaribu tena.';
const DEFAULT_RETRY = 'Jaribu tena';

export class PilotErrorBoundary extends Component<
  PilotErrorBoundaryProps,
  PilotErrorBoundaryState
> {
  static getDerivedStateFromError(err: unknown): PilotErrorBoundaryState {
    const message = err instanceof Error ? err.message : String(err);
    return Object.freeze({ hasError: true, errorMessage: message });
  }

  constructor(props: PilotErrorBoundaryProps) {
    super(props);
    this.state = Object.freeze({ hasError: false });
    this.handleRetry = this.handleRetry.bind(this);
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Forward to the pilot Sentry wrapper. Captures structured-log
    // even when no DSN is configured — that's what feeds the
    // /api/v1/pilot/errors dashboard.
    captureError(error, {
      screen: this.props.screen ?? 'root',
      extra: {
        componentStack: info.componentStack ?? null,
      },
    });
  }

  private handleRetry(): void {
    // Fresh state object — never mutate in place.
    this.setState(Object.freeze({ hasError: false }));
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const title = this.props.fallbackTitle ?? DEFAULT_TITLE;
    const body = this.props.fallbackBody ?? DEFAULT_BODY;
    const retry = this.props.retryLabel ?? DEFAULT_RETRY;

    return (
      <View style={styles.container} accessibilityRole="alert">
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {this.state.errorMessage ? (
            <Text style={styles.detail} numberOfLines={3}>
              {this.state.errorMessage}
            </Text>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={retry}
            style={styles.button}
            onPress={this.handleRetry}
          >
            <Text style={styles.buttonText}>{retry}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  title: {
    fontSize: fontSize.h2,
    fontWeight: '700',
    color: colors.earth900,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  detail: {
    fontSize: fontSize.caption,
    color: colors.danger,
    fontFamily: 'Menlo',
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.gold,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  buttonText: {
    color: colors.earth900,
    fontWeight: '700',
    fontSize: fontSize.lead,
  },
});
