'use client';

// Employee document uploads and verification status. Files use the employee's folder in the private
// employee-documents bucket. Employees cannot delete submitted records.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/display-formatting';
import { getDocumentUrl, uploadSignedDocument } from '@/lib/actions/documents';
import { documentCategoryLabel, requiredDocumentKeys } from '@/lib/document-categories';
import { useNotifications } from '@/components/ui/Notifications';
import type { DocumentType } from '@/lib/document-categories';
import type { EmployeeDocumentRow } from '@/lib/documents/document-summary';

// Match the server upload limit and reject oversized files before sending them.
const maxBytes = 10 * 1024 * 1024;

/**
 * Use XMLHttpRequest for upload progress. Send the file as a raw body, with metadata in the query
 * string, to avoid multipart buffering.
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
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    // The bytes are gone but the server is still storing and filing them; show
    // the bar full rather than stalled at 99%.
    xhr.upload.onload = () => onProgress(100);

    xhr.onload = () => {
      const body = xhr.response as { ok?: boolean; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: body?.error ?? `The upload failed (${xhr.status}).` });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: 'The upload failed — check your connection.' });
    xhr.onabort = () => resolve({ ok: false, error: 'The upload was cancelled.' });

    xhr.send(file);
  });
}

function MyDocuments({
  documents,
  documentTypes,
  leaving = false,
  id,
}: {
  documents: EmployeeDocumentRow[];
  // The document types HR has set up.
  documentTypes: DocumentType[];
  // True when the employee is serving notice, so required exit documents apply to them.
  leaving?: boolean;
  id?: string;
}) {
  const router = useRouter();
  const activeTypes = documentTypes.filter((type) => type.active);
  // Required documents the employee has not filed yet, whatever their verification status.
  const filed = new Set(documents.map((d) => d.category));
  const stillNeeded = requiredDocumentKeys(documentTypes, leaving).filter((key) => !filed.has(key));
  const [category, setCategory] = useState<string>(
    stillNeeded[0] ?? activeTypes[0]?.key ?? 'other',
  );
  const [busy, setBusy] = useState(false);
  // null when idle; 0-100 while a file is in flight.
  const [progress, setProgress] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const { showNotification, notificationContainer } = useNotifications();

  async function open(id: string) {
    // Open the tab before awaiting the signed URL to retain user activation. Clear opener manually
    // because the noopener feature makes window.open return null.
    const win = window.open('about:blank', '_blank');
    if (win) {
      win.opener = null;
    }
    const res = await getDocumentUrl(id);
    if (!res.ok || !res.url) {
      win?.close();
      showNotification(res.error ?? 'Could not open the document.', 'error');
      return;
    }
    if (win) {
      win.location.href = res.url;
    } else {
      // popup blocked outright — navigate in place
      window.location.href = res.url;
    }
  }

  const verified = documents.filter((d) => d.verifiedAt).length;
  // Letters HR has sent for signing and that have not been returned yet.
  const toSign = documents.filter((d) => d.status === 'to_sign');
  const [signingId, setSigningId] = useState<string | null>(null);

  async function returnSigned(letter: EmployeeDocumentRow, file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showNotification('The signed letter must be a PDF file.', 'error');
      return;
    }
    if (file.size > maxBytes) {
      showNotification('Documents must be 10 MB or smaller.', 'error');
      return;
    }
    setSigningId(letter.id);
    const formData = new FormData();
    formData.set('file', file);
    const res = await uploadSignedDocument(letter.id, formData);
    setSigningId(null);
    if (!res.ok) {
      showNotification(res.error ?? 'The signed letter could not be uploaded.', 'error');
      return;
    }
    showNotification('Signed letter sent to HR.', 'success');
    startTransition(() => router.refresh());
  }

  return (
    <div className="card" id={id}>
      {notificationContainer}
      <div className="card-header">
        <h3>My documents</h3>
        <span className="card-caption">
          {documents.length ? `${verified}/${documents.length} verified` : 'none filed'}
        </span>
      </div>
      <div className="card-body">
        {toSign.length > 0 && (
          <div className="letters-to-sign">
            <b>
              {toSign.length === 1
                ? 'HR has sent you a letter to sign'
                : `HR has sent you ${toSign.length} letters to sign`}
            </b>
            <p className="text-muted">
              Download the letter, sign it, scan or save it as a PDF, and upload the signed copy
              here.
            </p>
            {toSign.map((letter) => (
              <div key={letter.id} className="letter-to-sign">
                <div className="letter-to-sign-name">
                  <b>
                    {letter.title ?? documentCategoryLabel(letter.category, false, documentTypes)}
                  </b>
                  <span className="text-muted">
                    {documentCategoryLabel(letter.category, false, documentTypes)} · sent{' '}
                    {formatDate(letter.uploadedAt.slice(0, 10))}
                  </span>
                </div>
                <button type="button" className="button" onClick={() => open(letter.id)}>
                  ⬇ Download
                </button>
                <label className={`button primary${signingId === letter.id ? ' is-busy' : ''}`}>
                  {signingId === letter.id ? 'Uploading…' : 'Upload signed copy'}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    disabled={signingId !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) {
                        void returnSigned(letter, file);
                      }
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
        )}
        {stillNeeded.length > 0 && (
          <div className="hint" style={{ marginBottom: 12 }}>
            <b>
              {stillNeeded.length} required document{stillNeeded.length === 1 ? '' : 's'} still to
              upload:
            </b>{' '}
            {stillNeeded.map((key) => documentCategoryLabel(key, false, documentTypes)).join(' · ')}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>Type</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {activeTypes.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                  {type.required ? ' (required)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ flex: '1 1 200px', marginBottom: 0 }}>
            <label>File</label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) {
                  return;
                }
                // Refuse before sending anything. The server checks again — it
                // has to, the route is reachable directly — but finding out
                // after a full upload is the worst place to learn it.
                if (file.size > maxBytes) {
                  e.target.value = '';
                  showNotification(
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
                if (!res.ok) {
                  showNotification(res.error ?? 'The upload failed.', 'error');
                } else {
                  showNotification('Document filed — HR will verify it.', 'success');
                  // Uploads use a route handler, so explicitly refresh the server-rendered
                  // document list.
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
                    background: 'var(--border-strong)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      width: `${progress}%`,
                      height: '100%',
                      background: 'var(--attendance-present)',
                      transition: 'width .15s linear',
                    }}
                  />
                </span>
                <span className="text-monospace" style={{ whiteSpace: 'nowrap' }}>
                  {progress < 100 ? `${progress}%` : 'Filing…'}
                </span>
              </span>
            )}
          </div>
        </div>

        {documents.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
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
                    <td>
                      {documentCategoryLabel(d.category, d.source === 'issued', documentTypes)}
                    </td>
                    <td className="text-monospace">{formatDate(d.uploadedAt.slice(0, 10))}</td>
                    <td>
                      {d.status === 'to_sign' ? (
                        <span
                          className="status-badge"
                          style={{
                            borderColor: 'var(--border-strong)',
                            color: 'var(--attendance-half-day)',
                          }}
                        >
                          Sign and return
                        </span>
                      ) : d.verifiedAt ? (
                        <span
                          className="status-badge"
                          style={{
                            borderColor: 'var(--attendance-present-border)',
                            color: 'var(--attendance-present)',
                            background: 'var(--attendance-present-background)',
                          }}
                        >
                          Verified
                        </span>
                      ) : d.verifyRemark ? (
                        <>
                          <span
                            className="status-badge"
                            style={{
                              borderColor: 'var(--border-strong)',
                              color: 'var(--attendance-half-day)',
                            }}
                          >
                            Needs fixing
                          </span>
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--attendance-half-day)',
                              marginTop: 2,
                            }}
                          >
                            {d.verifyRemark}
                          </div>
                        </>
                      ) : (
                        <span
                          className="status-badge"
                          style={{
                            borderColor: 'var(--attendance-late-border)',
                            color: 'var(--attendance-late)',
                            background: 'var(--attendance-late-background)',
                          }}
                        >
                          Awaiting HR
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="button quiet" onClick={() => open(d.id)}>
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

export { MyDocuments };
