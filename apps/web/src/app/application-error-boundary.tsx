import { RefreshCw, TriangleAlert } from "lucide-react";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";

type ApplicationErrorBoundaryProps = {
  children: ReactNode;
};

type ApplicationErrorBoundaryState = {
  errorId: string | null;
};

export class ApplicationErrorBoundary extends Component<
  ApplicationErrorBoundaryProps,
  ApplicationErrorBoundaryState
> {
  public override state: ApplicationErrorBoundaryState = { errorId: null };

  public static getDerivedStateFromError(): ApplicationErrorBoundaryState {
    return { errorId: crypto.randomUUID() };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[${this.state.errorId ?? "renderer"}] RENDERER_RENDER_FAILED`,
      error,
      info.componentStack,
    );
  }

  public override render(): ReactNode {
    if (this.state.errorId === null) return this.props.children;

    return (
      <main className="application-error-boundary">
        <section className="application-error-boundary__content">
          <TriangleAlert aria-hidden="true" size={22} />
          <h1>页面暂时无法显示</h1>
          <p>重新加载后可以继续使用，未发送的输入可能需要重新填写。</p>
          <small>错误编号：{this.state.errorId}</small>
          <button type="button" onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden="true" size={15} />
            重新加载
          </button>
        </section>
      </main>
    );
  }
}
