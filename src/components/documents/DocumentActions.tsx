'use client';

import type { ReactNode } from 'react';

interface DocumentActionsProps {
  title: string;
  busy: boolean;
  onOpen: () => void;
  onVerify?: () => void;
  onReplace?: () => void;
  onReturn?: () => void;
  onDelete?: () => void;
}

function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// Identical button sizes keep the queue and register aligned without hiding any actions.
function DocumentActions({
  title,
  busy,
  onOpen,
  onVerify,
  onReplace,
  onReturn,
  onDelete,
}: DocumentActionsProps) {
  const actions = [
    {
      label: 'Open document',
      onClick: onOpen,
      kind: 'quiet',
      icon: (
        <ActionIcon>
          <path d="M14 3h7v7M21 3 11 13" />
          <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
        </ActionIcon>
      ),
    },
    {
      label: 'Mark as checked and correct',
      onClick: onVerify,
      kind: 'primary',
      icon: (
        <ActionIcon>
          <path d="m5 12 4 4L19 6" />
        </ActionIcon>
      ),
    },
    {
      label: 'Replace with a new file',
      onClick: onReplace,
      kind: 'quiet',
      icon: (
        <ActionIcon>
          <path d="M20 7H4m0 0 4-4M4 7l4 4M4 17h16m0 0-4-4m4 4-4 4" />
        </ActionIcon>
      ),
    },
    {
      label: 'Send back to the employee to fix',
      onClick: onReturn,
      kind: 'quiet',
      icon: (
        <ActionIcon>
          <path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-3" />
        </ActionIcon>
      ),
    },
    {
      label: 'Delete document',
      onClick: onDelete,
      kind: 'quiet document-delete',
      icon: (
        <ActionIcon>
          <path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7m4-7v7" />
        </ActionIcon>
      ),
    },
  ];

  return (
    <div className="document-actions" role="group" aria-label={`Actions for ${title}`}>
      {actions.map((action) =>
        action.onClick ? (
          <button
            key={action.label}
            type="button"
            className={`button document-action ${action.kind}`}
            title={action.label}
            aria-label={`${action.label}: ${title}`}
            disabled={busy}
            onClick={action.onClick}
          >
            {action.icon}
          </button>
        ) : null,
      )}
    </div>
  );
}

export { DocumentActions };
