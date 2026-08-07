'use client';

// HR's document verification queue: everything filed and not yet verified.
// Verifying stamps verified_by/verified_at; returning one clears the stamp and
// records why, so a rejected document stays on file as visibly unverified rather
// than disappearing (the employee has no delete permission by design).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { verifyEmployeeDocument, getDocumentUrl } from '@/lib/actions/documents';
import { usePrompt } from '@/components/ui/PromptDialog';
import { useToast } from '@/components/ui/Toast';
import type { EmployeeDocumentRow } from '@/lib/queries';

const CATEGORY_LABEL: Record<string, string> = {
  offer_letter: 'Offer letter',
  id_proof: 'ID proof',
  education: 'Education',
  experience: 'Experience',
  bank: 'Bank details',
  other: 'Other',
  // Issued by HR via generateExitDocument — display only, never uploadable.
  relieving: 'Relieving letter',
  settlement: 'Full & final statement',
};

export function DocumentQueue({ documents }: { documents: EmployeeDocumentRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const { prompt, promptDialog } = usePrompt();
  const { toast, toastNode } = useToast();

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) toast(res.error ?? 'The action failed.', 'error');
      else {
        toast(okMsg, 'success');
        router.refresh();
      }
    });
  }

  async function onReturn(d: EmployeeDocumentRow) {
    const reason = await prompt({
      title: 'Return document',
      message: 'What is wrong with it? (shown to the employee)',
      placeholder: 'e.g. The PAN scan is cut off at the edge',
      confirmLabel: 'Return',
      danger: true,
      validate: (v) => (v.trim() ? null : 'Enter what needs fixing.'),
    });
    if (reason === null) return;
    run(d.id, () => verifyEmployeeDocument(d.id, false, reason.trim()), 'Document returned to the employee.');
  }

  async function open(id: string) {
    // Claim the tab INSIDE the click gesture — see MyDocuments.open().
    const win = window.open('', '_blank', 'noopener,noreferrer');
    const res = await getDocumentUrl(id);
    if (!res.ok || !res.url) {
      win?.close();
      toast(res.error ?? 'Could not open the document.', 'error');
      return;
    }
    if (win) win.location.href = res.url;
    else window.location.href = res.url;
  }

  return (
    <div className="card">
      {promptDialog}
      {toastNode}
      <div className="hd">
        <h3>Documents awaiting verification</h3>
        <span className="folio">{documents.length}</span>
      </div>
      {documents.length === 0 ? (
        <div className="bd">
          <p className="muted" style={{ margin: 0 }}>Nothing waiting — every filed document is verified.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Document</th>
                <th>Category</th>
                <th>Filed</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>
                    <b>{d.name}</b>{' '}
                    <span className="mono muted" style={{ fontSize: 11 }}>{d.code}</span>
                  </td>
                  <td>
                    {d.title ?? '—'}
                    {d.verifyRemark && (
                      <div style={{ fontSize: 11, color: 'var(--hd)' }}>
                        <b>Returned:</b> {d.verifyRemark}
                      </div>
                    )}
                  </td>
                  <td>{d.category ? CATEGORY_LABEL[d.category] ?? d.category : '—'}</td>
                  <td className="mono">{formatDate(d.uploadedAt.slice(0, 10))}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn quiet" onClick={() => open(d.id)}>
                        📎 Open
                      </button>
                      <button
                        className="btn primary"
                        disabled={pending && busy === d.id}
                        onClick={() => run(d.id, () => verifyEmployeeDocument(d.id, true), 'Document verified.')}
                      >
                        {pending && busy === d.id ? '…' : '✓ Verify'}
                      </button>
                      <button
                        className="btn"
                        disabled={pending && busy === d.id}
                        onClick={() => onReturn(d)}
                      >
                        Return
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
