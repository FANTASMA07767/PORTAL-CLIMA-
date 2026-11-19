import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Error inesperado en la consola climática.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('JMAC-Climatyc ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public render() {
    if (this.state.hasError) {
      let parsedDetail: string | null = null;
      let isQuotaError = false;
      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed && typeof parsed.error === 'string') {
          parsedDetail = `${parsed.operationType?.toUpperCase() ?? 'DB'} en "${parsed.path ?? '/'}": ${parsed.error}`;
          if (parsed.error.includes('Quota exceeded')) {
            isQuotaError = true;
          }
        }
      } catch {
        if (this.state.errorMessage.includes('Quota exceeded')) {
          isQuotaError = true;
        }
      }

      return (
        <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-sky-50 text-slate-900 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-lg font-semibold font-display text-slate-950">
                Interrupción controlada de operación
              </h2>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              {isQuotaError
                ? 'Se alcanzó el límite diario gratuito de lecturas/escrituras de la base de datos. La cuota se restablece al día siguiente.'
                : parsedDetail || this.state.errorMessage}
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reintentar vista operativa
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
