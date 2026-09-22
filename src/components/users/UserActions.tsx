'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface UserAction {
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function UserActions({
  name,
  disabled,
  canDelete,
  onAccess,
  onSetPassword,
  onSendReset,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  canDelete: boolean;
  onAccess?: () => void;
  onSetPassword: () => void;
  onSendReset: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const items: UserAction[] = [
    ...(onAccess ? [{ label: 'Tab access', action: onAccess }] : []),
    { label: 'Set password', action: onSetPassword },
    { label: 'Send reset', action: onSendReset },
    { label: 'Delete login…', action: onDelete, disabled: !canDelete, danger: true },
  ];

  return (
    <div
      ref={root}
      className="users-actions"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="btn quiet users-actions-toggle"
        disabled={disabled}
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Actions
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${name}`}
          className="users-actions-menu"
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              return;
            }
            event.preventDefault();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            );
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`btn quiet${item.danger ? ' users-delete' : ''}`}
              disabled={disabled || item.disabled}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                item.action();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { UserActions };
