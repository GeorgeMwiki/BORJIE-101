/**
 * Intelligent Error Boundary — Enhanced with analytics
 *
 * Catches React rendering errors and:
 *   - Reports structured error data to platform intelligence API
 *   - Shows user-friendly recovery UI
 *   - Provides "Report this issue" with pre-filled context
 *
 * Ported verbatim from sibling-port src/components/ErrorBoundaryIntelligent.tsx
 * with session-storage key rebranded to borjie_pi_session.
 */

"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw, MessageSquare } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface Props {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly portal?: string;
  /** Optional Sentry-style capture hook injected by host app. */
  readonly captureException?: (
    error: Error,
    context?: {
      tier?: string;
      route?: string;
      extra?: Readonly<Record<string, unknown>>;
    },
  ) => void;
}

interface State {
  readonly hasError: boolean;
  readonly error: Error | null;
  readonly errorInfo: ErrorInfo | null;
  readonly reported: boolean;
}

// ============================================================================
// Error Reporter
// ============================================================================

function reportErrorToIntelligence(
  error: Error,
  errorInfo: ErrorInfo | null,
  portal?: string,
): void {
  try {
    const payload = {
      events: [
        {
          sessionId:
            typeof sessionStorage !== "undefined"
              ? (sessionStorage.getItem("borjie_pi_session") ?? "unknown")
              : "server",
          eventName: "error_occurred",
          eventCategory: "error",
          portal: portal ?? "unknown",
          pagePath:
            typeof window !== "undefined"
              ? window.location.pathname
              : undefined,
          properties: {
            error: error.message,
            stack: error.stack?.slice(0, 1000),
            componentStack: errorInfo?.componentStack?.slice(0, 500),
            severity: "critical",
            source: "error_boundary",
            userAgent:
              typeof navigator !== "undefined"
                ? navigator.userAgent
                : undefined,
          },
        },
      ],
    };

    // Fire-and-forget
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/platform-intelligence/events",
        new Blob([JSON.stringify(payload)], { type: "application/json" }),
      );
    } else if (typeof fetch !== "undefined") {
      fetch("/api/platform-intelligence/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {}); // Non-critical: error telemetry reporting from client, safe to swallow
    }
  } catch {
    // Non-critical: error reporting must never cause additional errors in the error boundary
  }
}

// ============================================================================
// Fallback
// ============================================================================

function IntelligentErrorFallback({
  error,
  reported,
  onRetry,
  onReload,
}: {
  readonly error: Error | null;
  readonly reported: boolean;
  readonly onRetry: () => void;
  readonly onReload: () => void;
}) {
  return (
    <div className="min-h-[300px] flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="w-14 h-14 mx-auto mb-4 bg-red-50 dark:bg-red-950/30 rounded-full flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-500" />
        </div>

        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
          An unexpected error occurred. We have been notified.
        </p>
        {reported && (
          <p className="text-xs text-green-600 dark:text-green-400 mb-4">
            Error reported automatically.
          </p>
        )}

        {process.env.NODE_ENV === "development" && error && (
          <details className="text-left mt-4 mb-4 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs">
            <summary className="cursor-pointer text-gray-500 font-medium">
              Error details (dev only)
            </summary>
            <pre className="mt-2 text-red-600 dark:text-red-400 overflow-auto max-h-40 whitespace-pre-wrap">
              {error.message}
              {"\n\n"}
              {error.stack?.slice(0, 500)}
            </pre>
          </details>
        )}

        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
          <button
            onClick={onReload}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export class ErrorBoundaryIntelligent extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      reported: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    reportErrorToIntelligence(error, errorInfo, this.props.portal);
    if (this.props.captureException) {
      this.props.captureException(error, {
        tier: "app",
        route:
          typeof window !== "undefined" ? window.location.pathname : undefined,
        extra: {
          component_stack: errorInfo?.componentStack?.slice(0, 500),
          portal: this.props.portal,
        },
      });
    }
    this.setState({ reported: true });
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      reported: false,
    });
  };

  handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <IntelligentErrorFallback
          error={this.state.error}
          reported={this.state.reported}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
        />
      );
    }

    return this.props.children;
  }
}
