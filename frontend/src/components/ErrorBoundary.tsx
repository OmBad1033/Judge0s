import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Log to console for now — Phase 8 will wire this to a reporting service.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;
    if (!hasError || !error) return children;

    if (fallback) return fallback(error, this.reset);

    return (
      <div className="dot-grid min-h-screen text-on-surface font-body flex items-center justify-center px-4">
        <div className="term-card max-w-md w-full p-6 flex flex-col gap-4 text-center">
          <span className="material-symbols-outlined text-4xl text-danger mx-auto">error</span>
          <h2 className="font-mono text-display-sm uppercase tracking-[-0.01em]">Something_Broke</h2>
          <p className="font-body text-body text-on-surface-variant">
            An unexpected error occurred. You can try again, or head back to the landing page.
          </p>
          {error.message && (
            <pre className="font-mono text-micro text-muted text-left bg-surface-1 border border-border p-3 overflow-x-auto">
              {error.message}
            </pre>
          )}
          <div className="flex flex-col sm:flex-row gap-2 justify-center mt-2">
            <button onClick={this.reset} className="term-button-primary">
              <span className="material-symbols-outlined text-[18px]">refresh</span>
              <span>Try_Again</span>
            </button>
            <a href="/" className="term-button-secondary">
              <span className="material-symbols-outlined text-[18px]">home</span>
              <span>Landing_Page</span>
            </a>
          </div>
        </div>
      </div>
    );
  }
}