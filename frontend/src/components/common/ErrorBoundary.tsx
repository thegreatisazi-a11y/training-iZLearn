import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render/lazy-import errors so a single broken screen never blanks the
 * whole app. After a new deploy the browser may still hold the old index.html,
 * whose chunk hashes no longer exist — the dynamic import then throws a
 * "Failed to fetch dynamically imported module" / "Loading chunk failed" error.
 * We detect that case and force a one-time reload (guarded so we never loop).
 */
const CHUNK_ERROR = /(dynamically imported module|Loading chunk|Importing a module script failed|ChunkLoadError)/i;
const RELOAD_KEY = 'iz-chunk-reload';

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Stale chunk after a deploy → reload once to pull the fresh index.html.
    if (CHUNK_ERROR.test(error.message) && !sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
      return;
    }
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  componentDidMount(): void {
    // Successful mount → clear the reload guard so future stale chunks can retry.
    sessionStorage.removeItem(RELOAD_KEY);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunk = CHUNK_ERROR.test(error.message);
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-800">
          {isChunk ? 'A new version is available' : 'Something went wrong'}
        </h1>
        <p className="max-w-md text-sm text-slate-500">
          {isChunk
            ? 'The app was updated. Reload to get the latest version.'
            : 'An unexpected error occurred while rendering this page.'}
        </p>
        <button
          type="button"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          onClick={() => {
            sessionStorage.removeItem(RELOAD_KEY);
            window.location.reload();
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
