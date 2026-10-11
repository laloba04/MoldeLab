import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/**
 * Red de seguridad: si algo revienta durante el render, React desmonta el
 * árbol entero y la página se queda en negro sin explicación. Esto lo para y
 * enseña el error de verdad, que es lo único útil para arreglarlo.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', color: '#ffb454' }}>
          <h2 style={{ marginBottom: 12 }}>La aplicación ha fallado</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button onClick={() => location.reload()} style={{ marginTop: 16, padding: '8px 16px' }}>
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Monta la app. Lo comparten las dos páginas —la de siempre y la de novedades—,
 * que son la misma aplicación con distinto catálogo: así lo que se arregla en
 * una queda arreglado en la otra.
 */
export function montar(novedades: boolean) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App novedades={novedades} />
      </ErrorBoundary>
    </StrictMode>,
  );
}
