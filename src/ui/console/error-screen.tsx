/**
 * WHEN THE CONSOLE FALLS OVER: not a white page, but what happened in the
 * console's own look — the error, a reload, and the details to copy for a bug
 * report. Built of plain elements and the tokens only: the kit itself may be
 * what threw. The save is untouched; a reload carries on from it.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null; stack: string };

export class ErrorScreen extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: `${error.stack ?? error.message}\n${info.componentStack ?? ""}` });
    console.error("The console fell over:", error, info.componentStack);
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n\n${stack}`;
    return (
      <div role="alert" className="flex h-full w-full items-center justify-center bg-surface-0 p-4 text-fg">
        <div className="flex w-full max-w-lg flex-col border border-line-strong border-t-2 border-t-bad bg-surface-1 shadow-2xl">
          <header className="border-b border-line-quiet px-5 pb-3 pt-4">
            <p className="text-[10px] uppercase tracking-widest text-bad">The console fell over</p>
            <h1 className="font-display text-xl tracking-wide">Something broke</h1>
          </header>
          <div className="flex flex-col gap-3 px-5 py-4 text-sm">
            <p className="text-fg-muted">Your progress is saved. Reloading carries on from where you were.</p>
            <pre className="max-h-48 overflow-auto border border-line-quiet bg-surface-0 p-2 text-[11px] leading-snug whitespace-pre-wrap text-bad">
              {error.name}: {error.message}
            </pre>
          </div>
          <footer className="flex justify-end gap-2 border-t border-line-quiet bg-surface-2/40 px-5 py-3">
            <button type="button" onClick={() => void navigator.clipboard?.writeText(details)}
              className="cursor-pointer border border-line bg-surface-2 px-3 py-1.5 text-sm hover:border-line-strong">
              Copy details
            </button>
            <button type="button" onClick={() => window.location.reload()}
              className="cursor-pointer border border-console bg-console-soft px-3 py-1.5 text-sm hover:bg-console-fill">
              Reload
            </button>
          </footer>
        </div>
      </div>
    );
  }
}
