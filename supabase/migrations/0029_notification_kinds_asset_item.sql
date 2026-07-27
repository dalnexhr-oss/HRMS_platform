-- ============================================================================
-- 0029 — notification kinds for asset & item events
--
-- Employees now get notified when HR assigns/returns an asset or item. Kept in
-- its own migration and NOT used within it — Postgres forbids using a freshly
-- added enum value in the same transaction, so the runtime inserts (a later
-- transaction) are what reference these.
-- ============================================================================
alter type notification_kind add value if not exists 'asset';
alter type notification_kind add value if not exists 'item';
