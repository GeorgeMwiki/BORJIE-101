/**
 * Pilot error boundary — catches every uncaught React error in the
 * workforce-mobile tree, reports it via the pilot Sentry wrapper, and
 * shows a "tap to retry" surface so the pilot never sees a white screen.
 *
 * Wiring
 * ──────
 * Mounted at the tree root in `_layout.tsx` (wraps the whole `<Stack>`), so a
 * render-phase error anywhere is caught, captured, and the user shown the
 * retry panel.
 *
 * Locale
 * ──────
 * The fallback copy is rendered in the ACTIVE locale (CLAUDE.md "English default
 * · bilingual sw/en"; the toggle is ABSOLUTE — zero Swahili to an EN user). This
 * is a class component mounted above the i18n provider, so it cannot use
 * `useI18n`; it reads the last-resolved locale from the `active-locale` module
 * cache (default `en`), which `useI18n` keeps current. A caller may still pass
 * explicit `fallbackTitle`/`fallbackBody`/`retryLabel` overrides.
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
import { getActiveLocale } from '../i18n/active-locale';
import type { Lang } from '../auth/types';
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

// Single-language-per-locale fallback copy. Selected by the active locale so no
// hardcoded off-locale string is ever painted on a crash. EN is the app default.
const FALLBACK_COPY: Readonly<
  Record<Lang, { readonly title: string; readonly body: string; readonly retry: string }>
> = {
  en: {
    title: 'Borjie hit an error.',
    body: "It's been logged. Tap to try again.",
    retry: 'Try again',
  },
  sw: {
    title: 'Borjie imekutana na hitilafu.',
    body: 'Imerekodiwa. Bonyeza ili ujaribu tena.',
    retry: 'Jaribu tena',
  },
};

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

    // Read the last-resolved active locale (module cache, default 'en') so the
    // crash panel is single-language-correct; explicit props still override.
    const copy = FALLBACK_COPY[getActiveLocale()];
    const title = this.props.fallbackTitle ?? copy.title;
    const body = this.props.fallbackBody ?? copy.body;
    const retry = this.props.retryLabel ?? copy.retry;

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
