import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    // Un deploy nuevo elimina los chunks del build anterior. Una pestaña que
    // llevaba horas abierta puede pedir ese hash viejo y la lazy import queda
    // rechazada de forma permanente; resetear el boundary no vuelve a pedirlo.
    // Recargar una vez obtiene el app shell vigente; el límite evita bucles si
    // el chunk también falta en el build actual.
    const message = String(error?.message || '');
    const esChunkObsoleto = /failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk [\w-]+ failed/i.test(message);
    if (esChunkObsoleto && typeof window !== 'undefined') {
      try {
        const key = `gdp:chunk-refresh:${window.location.pathname}`;
        const anterior = Number(window.sessionStorage.getItem(key) || 0);
        if (!anterior || Date.now() - anterior > 30_000) {
          window.sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
        }
      } catch { /* Si el navegador bloquea sessionStorage queda disponible Reintentar. */ }
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-8 text-center max-w-md">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-300 mb-2">
              Algo salió mal
            </h2>
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">
              {this.state.error?.message || 'Error inesperado'}
            </p>
            <button
              onClick={() => {
                const error = this.state.error;
                if (/failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk [\w-]+ failed/i.test(String(error?.message || ''))) {
                  window.location.reload();
                } else {
                  this.setState({ hasError: false, error: null });
                }
              }}
              className="btn-danger"
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
