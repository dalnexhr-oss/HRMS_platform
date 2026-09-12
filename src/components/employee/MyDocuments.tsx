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
import { getDocumentUrl } from '@/lib/actions/documents';
import { documentCategories } from '@/lib/constants';
import { useToast } from '@/components/ui/Toast';
import type { EmployeeDocumentRow } from '@/lib/queries';

// Mirrors maxBytes in lib/documents/upload.ts. Checked HERE as well so an
// oversize file is refused instantly, instead of being uploaded in full and
// only then rejected — which on a phone is the slowest possible way to find out.
const maxBytes = 10 * 1024 * 1024;

/**
 * Send the file to the streaming upload route, reporting progress.
 *
 * XMLHttpRequest rather than fetch: it is still the only API that reports
 * UPLOAD progress in every browser this runs on. The file is the raw body
 * (the route reads its metadata from the query string), so nothing has to be
 * buffered into a multipart envelope on either side.
 */
function uploadWithProgress(
  file: File,
  category: string,
  onProgress: (percent: number) => void,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const query = new URLSearchParams({ filename: file.name, category, title: file.name });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/documents/upload?${query}`);
    xhr.responseType = 'json';

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    // The bytes are gone but the server is still storing and filing them; show
    // the bar full rather than stalled at 99%.
    xhr.upload.onload = () => onProgress(100);

    xhr.onload = () => {
      const body = xhr.response as { ok?: boolean; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) resolve({ ok: true });
      else resolve({ ok: false, error: body?.error ?? `The upload failed (${xhr.status}).` });
    };
    xhr.onerror = () => resolve({ ok: false, error: 'The upload failed — check your connection.' });
    xhr.onabort = () => resolve({ ok: false, error: 'The upload was cancelled.' });

    xhr.send(file);
  });
}

const categoryLabel: Record<string, string> = {
  offer_letter: 'Offer letter',
  id_proof: 'ID proof (Aadhaar / PAN)',
  education: 'Education certificate',
  experience: 'Experience letter',
  bank: 'Bank details',
  other: 'Other',
  // Issued BY HR (generateExitDocument) — display only. These are deliberately
  // absent from documentCategories so they never appear in the upload dropdown:
  // an employee must not be able to file their own relieving letter.
  relieving: 'Relieving letter',
  settlement: 'Full & final statement',
};

export function MyDocuments({ documents, id }: { documents: EmployeeDocumentRow[]; id?: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<string>('id_proof');
  const [busy, setBusy] = useState(false);
  // null when idle; 0-100 while a file is in flight.
  const [progress, setProgress] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const { toast, toastNode } = useToast();

  async function open(id: string) {
    // Claim the tab INSIDE the click gesture. Signing needs a server round trip,
    // and a window.open() after that await has lost its user activation — browsers
    // then swallow it silently, so the button looks dead.
    // No 'noopener' in the features string: with it, window.open() returns null
    // by spec, so every successful open fell through to the else branch and
    // navigated THIS tab away to the signed URL. Sever the opener link by hand.
    const win = window.open('about:blank', '_blank');
    if (win) win.opener = null;
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
              {documentCategories.map((c) => (
                <option key={c} value={c}>{categoryLabel[c] ?? c}</option>
              ))}
            </select>
          </div>
          <div className="f" style={{ flex: '1 1 200px', marginBottom: 0 }}>
            <label>File</label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                // Refuse before sending anything. The server checks again — it
                // has to, the route is reachable directly — but finding out
                // after a full upload is the worst place to learn it.
                if (file.size > maxBytes) {
                  e.target.value = '';
                  toast(
                    `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Documents must be 10 MB or smaller.`,
                    'error',
                  );
                  return;
                }
                setBusy(true);
                setProgress(0);
                const res = await uploadWithProgress(file, category, setProgress);
                setBusy(false);
                setProgress(null);
                e.target.value = '';
                if (!res.ok) toast(res.error ?? 'The upload failed.', 'error');
                else {
                  toast('Document filed — HR will verify it.', 'success');
                  // The route revalidates /me server-side, but this component
                  // was not rendered by a Server Action, so nothing pushes the
                  // fresh tree down on its own — unlike an action call, which
                  // carries the re-render in its own response.
                  startTransition(() => router.refresh());
                }
              }}
            />
            {progress === null ? (
              <span className="hint">JPG/PNG/PDF, up to 10 MB.</span>
            ) : (
              <span className="hint" style={{ gap: 10, alignItems: 'center' }}>
                <span
                  aria-hidden="true"
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--line-2)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      width: `${progress}%`,
                      height: '100%',
                      background: 'var(--p)',
                      transition: 'width .15s linear',
                    }}
                  />
                </span>
                <span className="mono" style={{ whiteSpace: 'nowrap' }}>
                  {progress < 100 ? `${progress}%` : 'Filing…'}
                </span>
              </span>
            )}
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
                    <td>{d.category ? categoryLabel[d.category] ?? d.category : '—'}</td>
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
