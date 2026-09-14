import { useCallback, useEffect, useState } from 'react'

export type ToastItem = {
  id: string
  tone: 'ok' | 'warn' | 'error'
  message: string
}

type Props = {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastStack({ toasts, onDismiss }: Props) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(item.id), 4200)
    return () => window.clearTimeout(t)
  }, [item.id, onDismiss])

  return (
    <button
      type="button"
      className={`toast toast--${item.tone}`}
      onClick={() => onDismiss(item.id)}
    >
      {item.message}
    </button>
  )
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((tone: ToastItem['tone'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts((prev) => [...prev.slice(-4), { id, tone, message }])
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, push, dismiss }
}
