import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; fallback?: ReactNode }

type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="min-h-[40vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-lg font-semibold text-rose-200">Что-то пошло не так</p>
            <p className="text-sm text-slate-400 max-w-md">
              Обновите страницу. Если ошибка повторяется, откройте консоль разработчика и сообщите о ней.
            </p>
            <pre className="text-xs text-slate-500 max-w-full overflow-auto rounded-lg bg-slate-900/80 p-3 border border-white/10">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-sm font-medium text-white"
              onClick={() => window.location.reload()}
            >
              Обновить страницу
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
