'use client';

// The employee's own document locker: upload paperwork HR asked for, see what is
// verified, and reopen anything returned with a remark.
//
// Uploads land in the private employee-documents bucket under the employee's own
// folder; there is deliberately no delete — once filed, a document is HR's record
// (0037 grants the employee INSERT and SELECT only).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { uploadEmployeeDocument, getDocumentUrl } from '@/lib/actions/documents';
import { DOCUMENT_CATEGORIES } from '@/lib/constants';
import { useToast } from '@/components/ui/Toast';
import type { EmployeeDocumentRow } from '@/lib/queries';

const CATEGORY_LABEL: Record<string, string> = {
  offer_letter: 'Offer letter',
  id_proof: 'ID proof (Aadhaar / PAN)',
  education: 'Education certificate',
  experience: 'Experience letter',
  bank: 'Bank details',
  other: 'Other',
  // Issued BY HR (generateExitDocument) — display only. These are deliberately
  // absent from DOCUMENT_CATEGORIES so they never appear in the upload dropdown:
  // an employee must not be able to file their own relieving letter.
  relieving: 'Relieving letter',
  settlement: 'Full & final statement',
};

export function MyDocuments({ documents, id }: { documents: EmployeeDocumentRow[]; id?: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<string>('id_proof');
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const { toast, toastNode } = useToast();

  async function open(id: string) {
    // Claim the tab INSIDE the click gesture. Signing needs a server round trip,
    // and a window.open() after that await has lost its user activation — browsers
    // then swallow it silently, so the button looks dead.
    const win = window.open('', '_blank', 'noopener,noreferrer');
    const res = await getDocumentUrl(id);
    if (!res.ok || !res.url) {
      win?.close();
      toast(res.error ?? 'Could not open the document.', 'error');
      return;
    }
    if (win) win.location.href = res.url;
    else window.location.href = res.url; // popup blocked outright — navigate in place
  }

  const verified = documents.filter((d) => d.verifiedAt).length;

  return (
    <div className="card" id={id}>
      {toastNode}
      <div className="hd">
        <h3>My documents</h3>
        <span className="folio">
          {documents.length ? `${verified}/${documents.length} verified` : 'none filed'}
        </span>
      </div>
      <div className="bd">
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="f" style={{ marginBottom: 0 }}>
            <label>Type</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>
              ))}
            </select>
          </div>
          <div className="f" style={{ flex: '1 1 200px', marginBottom: 0 }}>
            <label>File</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                const fd = new FormData();
                fd.set('file', file);
                fd.set('category', category);
                fd.set('title', file.name);
                const res = await uploadEmployeeDocument(fd);
                setBusy(false);
                e.target.value = '';
                if (!res.ok) toast(res.error ?? 'The upload failed.', 'error');
                else {
                  toast('Document filed — HR will verify it.', 'success');
                  startTransition(() => router.refresh());
                }
              }}
            />
            <span className="hint">{busy ? 'Uploading…' : 'JPG/PNG/PDF, up to 10 MB.'}</span>
          </div>
        </div>

        {documents.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Nothing filed yet. Upload what HR has asked for and it will appear here.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Filed</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title ?? '—'}</td>
                    <td>{d.category ? CATEGORY_LABEL[d.category] ?? d.category : '—'}</td>
                    <td className="mono">{formatDate(d.uploadedAt.slice(0, 10))}</td>
                    <td>
                      {d.verifiedAt ? (
                        <span
                          className="pill"
                          style={{ borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' }}
                        >
                          Verified
                        </span>
                      ) : d.verifyRemark ? (
                        <>
                          <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--hd)' }}>
                            Needs fixing
                          </span>
                          <div style={{ fontSize: 11, color: 'var(--hd)', marginTop: 2 }}>{d.verifyRemark}</div>
                        </>
                      ) : (
                        <span
                          className="pill"
                          style={{ borderColor: 'var(--lm-line)', color: 'var(--lm)', background: 'var(--lm-bg)' }}
                        >
                          Awaiting HR
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="btn quiet" onClick={() => open(d.id)}>
                        📎 Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
