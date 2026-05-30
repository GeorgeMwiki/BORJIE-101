'use client';

/**
 * WidgetErrorBoundary — catches runtime crashes inside the Borjie
 * floating widget so they never propagate to the host page.
 *
 * Mirrors LitFin's LitFinErrorBoundary (verbatim port + brand swap):
 *   LITFIN_PATH/src/core/litfin-ai/components/LitFinErrorBoundary.tsx
 *
 * Auto-retries ChunkLoadErrors (common in dev mode when Webpack /
 * Turbopack is still compiling lazy-loaded chunks) with exponential
 * back-off, then shows a minimal recovery card that lets the user
 * retry without refreshing.
 *
 * NB: We avoid console.log per the global lint hook — uses pino-style
 * structured logging via the package logger if available, falling
 * back to console.error (which is allowed).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { logger } from '../logger.js';

const MAX_AUTO_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000] as const;

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly hasError: boolean;
  readonly error: Error | null;
  readonly retryCount: number;
  readonly isAutoRetrying: boolean;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  return (
    error.name === 'ChunkLoadError' ||
    error.message.includes('Loading chunk') ||
    error.message.includes('ChunkLoadError')
  );
}

function WidgetErrorFallback({
  isRetrying,
  isChunk,
  onReset,
}: {
  readonly isRetrying: boolean;
  readonly isChunk: boolean;
  readonly onReset: () => void;
}): JSX.Element {
  const message = isRetrying
    ? 'Mr. Mwikila is reloading…'
    : isChunk
    ? 'A chunk failed to load. Try again.'
    : 'Mr. Mwikila ran into an issue. Try again.';

  const buttonLabel = isRetrying ? 'Loading…' : 'Try again';

  return (
    <div
      role="alert"
      className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
    >
      <div className="mb-3">
        {isRetrying ? (
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : (
          <svg
            className="mx-auto h-8 w-8 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onReset}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

export class WidgetErrorBoundary extends Component<Props, State> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
      isAutoRetrying: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    logger.error('borjie-widget:error-boundary caught', {
      err: error.message,
      name: error.name,
    });

    if (isChunkLoadError(error) && this.state.retryCount < MAX_AUTO_RETRIES) {
      const delay = RETRY_DELAYS[this.state.retryCount] ?? 8000;
      this.setState({ isAutoRetrying: true });
      this.retryTimer = setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
          isAutoRetrying: false,
        }));
      }, delay);
    }
  }

  override componentWillUnmount(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  private readonly handleReset = (): void => {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.setState({
      hasError: false,
      error: null,
      retryCount: 0,
      isAutoRetrying: false,
    });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <WidgetErrorFallback
          isRetrying={this.state.isAutoRetrying}
          isChunk={isChunkLoadError(this.state.error)}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}
