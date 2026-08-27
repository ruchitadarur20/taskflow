import { Component, ErrorInfo, ReactNode } from "react";
import { AlertOctagon } from "lucide-react";

import { Button } from "../ui/Button";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Last-resort catch for render-time errors anywhere below it in the tree.
 * React Query errors surface through each query's own `isError` state instead
 * (see StatusView) - this boundary is specifically for genuine rendering bugs.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
          <div className="rounded-full bg-danger/10 p-4">
            <AlertOctagon className="h-8 w-8 text-danger" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              An unexpected error interrupted this page. Reloading usually fixes it; if it keeps
              happening, please let your workspace admin know.
            </p>
          </div>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
