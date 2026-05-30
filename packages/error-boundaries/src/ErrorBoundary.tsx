"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

// ── Default fallback (no i18n dependency at package boundary; host wires its own) ──

function DefaultErrorFallback({
  error,
  onRetry,
}: {
  readonly error: Error | null;
  readonly onRetry: () => void;
}) {
  return (
    <div className="max-w-4xl mx-auto py-12 px-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/30">
        <h2 className="text-lg font-semibold text-red-900 dark:text-red-100">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error?.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={onRetry}
          className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

// ── Class boundary ──

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    // Caller may subclass to wire structured logging; default keeps the call
    // signature for React's contract without writing to console (no console.* in services).
    void error;
    void _errorInfo;
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <DefaultErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}
