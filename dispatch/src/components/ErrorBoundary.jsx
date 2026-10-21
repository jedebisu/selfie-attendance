import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

// Catches render errors in a subtree (e.g. the work-order details drawer) so
// one bad record cannot unmount the whole application.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="drawer-backdrop" onClick={this.props.onClose}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-body">
              <div className="alert alert-warn" style={{ marginTop: 0 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Something went wrong displaying this work order.</strong>
                  <div className="muted small">The board is still usable — only this detail panel hit an error.</div>
                </div>
              </div>
              <div className="form-row">
                <button className="btn" onClick={this.reset}>Try again</button>
                <button className="btn" onClick={this.props.onClose}>Close details</button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}