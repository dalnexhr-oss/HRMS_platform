import 'server-only';
import { db, withTransaction } from '@/lib/db/mongodb-connection';
import { reserveWrite } from '@/lib/db/write-reservations';
import { currentScope } from '@/lib/db/access-scope';
import { mayAccessCollection } from '@/lib/db/collection-access';
import type { Document } from 'mongodb';

type Stored = Document & { _id: string };

/** The uploaded object is immutable; only metadata is retried. All successors serialize by group. */
async function commitDocumentReplacement(
  previousId: string,
  next: Document,
  signed = false,
): Promise<void> {
  const scope = await currentScope();
  if (
    !scope ||
    (signed
      ? next.employee_id !== scope.employeeId
      : !scope.isStaff || !mayAccessCollection(scope, 'employee_documents', true))
  ) {
    throw new Error('You do not have permission to replace this document.');
  }
  await withTransaction(
    async (session) => {
      const documents = (await db()).collection<Stored>('employee_documents');
      const previous = await documents.findOne(
        { _id: previousId, employee_id: next.employee_id },
        { session },
      );
      if (
        !previous ||
        previous.bucket === 'generated-documents' ||
        (signed && previous.signature !== 'requested')
      ) {
        throw new Error('This document cannot be replaced.');
      }
      const group = String(previous.doc_group ?? previous._id);
      await reserveWrite(`document:${group}`, session);
      const saved = await documents.findOne(
        { _id: String(next.id), replaces_id: previousId },
        { session },
      );
      if (saved && previous.replaced_by_id === saved._id && previous.superseded_at) {
        return; // Retry after a committed acknowledgement was lost.
      }
      if (previous.superseded_at || Number(next.version) !== Number(previous.version ?? 1) + 1) {
        throw new Error('That version has already been replaced. Refresh the document list.');
      }
      const other = await documents.findOne(
        { doc_group: group, superseded_at: null, _id: { $ne: previousId } },
        { session },
      );
      if (other) {
        throw new Error(
          'This document already has another current version. Reconcile its history before replacing it.',
        );
      }
      const now = new Date();
      const closed = await documents.updateOne(
        { _id: previousId, superseded_at: null },
        {
          $set: { doc_group: group, superseded_at: now, replaced_by_id: next.id, updated_at: now },
        },
        { session },
      );
      if (closed.matchedCount !== 1) {
        throw new Error('The current document changed. Nothing was replaced.');
      }
      const { id, ...fields } = next;
      await documents.insertOne(
        {
          _id: String(id),
          ...fields,
          doc_group: group,
          uploaded_at: now,
          created_at: now,
          updated_at: now,
        },
        { session },
      );
    },
    { required: true },
  );
}

export { commitDocumentReplacement };
