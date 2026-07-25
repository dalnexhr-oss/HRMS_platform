'use client';

// Lightweight, self-contained toast — a styled replacement for alert(). Use the
// useToast() hook: `const { toast, toastNode } = useToast()`, call
// `toast('Saved', 'success')`, and render {toastNode} once in the component.
// Toasts auto-dismiss; click to dismiss early.
import { useCallback, useEffect, useState } from 'react';

export type ToastKind = 'info' | 'error' | 'success';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

// Module-level counter for stable ids (avoids Date.now()/Math.random()).
let seq = 0;

function ToastRow({ toast, onDone }: { toast: ToastItem; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={`toast${toast.kind !== 'info' ? ` ${toast.kind}` : ''}`} role="status" onClick={onDone}>
      {toast.message}
    </div>
  );
}

export function useToast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    seq += 1;
    const id = seq;
    setItems((list) => [...list, { id, message, kind }]);
  }, []);

  const toastNode = (
    <div className="toast-wrap" aria-live="polite">
      {items.map((t) => (
        <ToastRow key={t.id} toast={t} onDone={() => dismiss(t.id)} />
      ))}
    </div>
  );

  return { toast, toastNode };
}
