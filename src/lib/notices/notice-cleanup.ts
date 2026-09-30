import 'server-only';
import { deleteExpiredNotices } from '@/lib/db/scheduled-jobs';

/**
 * Run best-effort notice cleanup when staff publish. Use the scheduler's retention implementation
 * and keep cleanup failures from blocking the publish flow.
 */
async function purgeExpiredNotices(): Promise<void> {
  try {
    await deleteExpiredNotices();
  } catch {
    // ignore — this is opportunistic cleanup, not required for correctness
  }
}

export { purgeExpiredNotices };
