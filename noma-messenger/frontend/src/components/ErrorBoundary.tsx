import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps a rendering bug from blanking the whole messenger. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('NOMA crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="splash">
        <div className="crash-card">
          <div className="crash-title">Что-то пошло не так</div>
          <div className="crash-text">{this.state.error.message}</div>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      </div>
    );
  }
}
