import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.name ?? "ErrorBoundary"}]`, error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--theme-text-subtle)]">
            <div className="text-center">
              <p>Something went wrong</p>
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="mt-2 text-xs underline"
              >
                Try again
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
