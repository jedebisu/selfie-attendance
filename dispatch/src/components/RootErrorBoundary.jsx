import { Component } from 'react';

export default class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[RootErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="root-error">
          <div className="root-error-card">
            <div className="root-error-icon">!</div>
            <h2>Something went wrong</h2>
            <p className="muted">An unexpected error crashed this page. Reload to continue, or try again.</p>
            <pre className="root-error-detail">{this.state.error.message || String(this.state.error)}</pre>
            <div className="flex" style={{ gap: 8, justifyContent: 'center' }}>
              <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
              <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}