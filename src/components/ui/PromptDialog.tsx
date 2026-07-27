'use client';

// Styled text-input modal — a themed replacement for window.prompt(). Use the
// usePrompt() hook: `const { prompt, promptDialog } = usePrompt()`, then
// `const value = await prompt({ title, message, ... })` (resolves the typed
// string, or null on cancel) and render {promptDialog} once in the component.
// Matches the app's overlay/card look and the useConfirm() ergonomics.
//
// Two extra guards beyond a bare prompt:
//   - `matchToken`: the confirm button stays disabled until the typed value
//     equals the token (case-insensitive). This preserves the deliberate
//     "type the email to confirm" friction on destructive actions.
//   - `validate`: return an error string to block submission, or null to allow.
import { useCallback, useEffect, useState } from 'react';

export interface PromptOptions {
  title?: string;
  message: string;
  /** Prefilled input value. */
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** 'text' | 'password' — mask the input for secrets (set-password). */
  inputType?: 'text' | 'password';
  /** Require the typed value to equal this token (case-insensitive) before confirming. */
  matchToken?: string;
  /** Return an error message to block submit, or null/undefined to allow. */
  validate?: (value: string) => string | null | undefined;
}

function PromptDialog({
  open,
  title,
  message,
  defaultValue = '',
  placeholder,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  inputType = 'text',
  matchToken,
  validate,
  onConfirm,
  onCancel,
}: PromptOptions & {
  open: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  // Reset the field each time the dialog opens for a fresh prompt.
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setError(null);
    }
  }, [open, defaultValue]);

  const matched = matchToken == null || value.trim().toLowerCase() === matchToken.toLowerCase();

  const submit = useCallback(() => {
    if (!matched) return;
    const err = validate?.(value);
    if (err) {
      setError(err);
      return;
    }
    onConfirm(value);
  }, [matched, validate, value, onConfirm]);

  // Escape cancels, Enter submits — only while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') submit();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, submit]);

  if (!open) return null;

  return (
    <>
      <div className="overlay on" onClick={onCancel} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title ?? 'Prompt'}>
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
            <span>{title ?? 'Please enter a value'}</span>
          </div>
          <div className="m-bd">
            <div style={{ whiteSpace: 'pre-line', marginBottom: 10 }}>{message}</div>
            <input
              type={inputType}
              value={value}
              placeholder={placeholder}
              autoFocus
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--line-2)',
                borderRadius: 8,
                font: 'inherit',
                fontSize: 14,
                background: '#fff',
              }}
            />
            {error && (
              <div className="login-error" style={{ marginTop: 8 }}>
                {error}
              </div>
            )}
          </div>
          <div className="m-ft">
            <button type="button" className="btn" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`btn ${danger ? 'danger' : 'primary'}`}
              onClick={submit}
              disabled={!matched}
              title={!matched ? 'The value does not match yet.' : undefined}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

type Pending = PromptOptions & { resolve: (v: string | null) => void };

/**
 * Promise-based prompt. `prompt(opts)` resolves the typed string, or null when
 * cancelled; render the returned `promptDialog` node once in your component tree.
 */
export function usePrompt() {
  const [pending, setPending] = useState<Pending | null>(null);

  const prompt = useCallback(
    (opts: PromptOptions) => new Promise<string | null>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  const settle = useCallback((value: string | null) => {
    setPending((p) => {
      p?.resolve(value);
      return null;
    });
  }, []);

  const promptDialog = (
    <PromptDialog
      open={pending !== null}
      title={pending?.title}
      message={pending?.message ?? ''}
      defaultValue={pending?.defaultValue}
      placeholder={pending?.placeholder}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      danger={pending?.danger}
      inputType={pending?.inputType}
      matchToken={pending?.matchToken}
      validate={pending?.validate}
      onConfirm={(v) => settle(v)}
      onCancel={() => settle(null)}
    />
  );

  return { prompt, promptDialog };
}
