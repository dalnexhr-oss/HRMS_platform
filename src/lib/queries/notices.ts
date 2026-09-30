import 'server-only';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import { isoOrNull, iso, fail } from '@/lib/queries/shared';
import { createClient } from '@/lib/db/server-client';

// notices
interface NoticeView {
  id: string;
  title: string;
  body: string | null;
  channel: 'app' | 'whatsapp' | 'both';
  branch: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  /** Storage path of the attached PDF (notice-attachments bucket), if any. */
  pdfPath: string | null;
}

/** Notices, newest first. */
async function getNotices(): Promise<NoticeView[]> {
  const notices = await scoped(collections.notices);
  const rows = await notices.find({}, { sort: { created_at: -1 } });
  return rows.map((n) => ({
    id: n._id as string,
    title: n.title as string,
    body: (n.body as string | null) ?? null,
    channel: n.channel as NoticeView['channel'],
    branch: (n.branch_name as string | null) ?? null,
    published: n.published_at != null,
    publishedAt: isoOrNull(n.published_at),
    createdAt: iso(n.created_at),
    pdfPath: (n.pdf_url as string | null) ?? null,
  }));
}

/** The ids of notices this employee has marked read (for the dashboard). */
async function getReadNoticeIds(employeeId: string | null): Promise<string[]> {
  if (!employeeId) {
    return [];
  }
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('notice_reads')
    .select<Array<{ notice_id: string }>>('notice_id')
    .eq('employee_id', employeeId);
  if (error) {
    fail('getReadNoticeIds: could not load read receipts', error);
  }
  return (data ?? []).map((r: { notice_id: string }) => r.notice_id);
}

export { getNotices, getReadNoticeIds };

export type { NoticeView };
