'use client';

// Styled confirmation modal — a themed replacement for window.confirm(). Use the
// useConfirm() hook: `const { confirm, confirmDialog } = useConfirm()`, then
// `if (!(await confirm({ title, message, danger }))) return;` and render
// {confirmDialog} once in the component. Matches the app's overlay/card look.
import { useCallback, useEffect, useState } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape cancels, Enter confirms — only while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <>
      <div className="overlay on" onClick={onCancel} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title ?? 'Confirm'}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="m-hd">
            {danger && (
              <span className="m-ic" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
              </span>
            )}
            <span>{title ?? 'Please confirm'}</span>
          </div>
          <div className="m-bd">{message}</div>
          <div className="m-ft">
            <button type="button" className="btn" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} autoFocus>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

/**
 * Promise-based confirm. `confirm(opts)` resolves true/false; render the returned
 * `confirmDialog` node once in your component tree.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  const settle = useCallback(
    (value: boolean) => {
      setPending((p) => {
        p?.resolve(value);
        return null;
      });
    },
    [],
  );

  const confirmDialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title}
      message={pending?.message ?? ''}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      danger={pending?.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}
