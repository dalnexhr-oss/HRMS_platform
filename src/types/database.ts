// ============================================================================
// Stable type barrel — import app types from '@/types/database'.
//
// This used to re-export a 59KB file of Supabase-generated schema types
// alongside the hand-written ones. Nothing imported the generated half (no
// Database, Tables<>, Enums<> or Json anywhere in the app), and there is no
// generator any more, so it went with the migration. Document shapes now live
// in src/lib/db/collections.ts, next to the collections they describe.
//
// The import path is unchanged so no call site had to move.
// ============================================================================

// Hand-written domain types (AppRole, AttendanceStatus, LeaveType, Policy, …).
export * from './app';
