/**
 * Notice retention in days, shared by scheduled and on-publish cleanup. Delete notices older than
 * the IST cutoff, measured from published_at or created_at for drafts.
 */
const noticeRetentionDays = 30;

export { noticeRetentionDays };
