// ============================================================================
// Stable type barrel — import app types from '@/types/database' as before.
//
// WHY THIS FILE EXISTS: `npm run db:types` regenerates the Supabase schema types
// by OVERWRITING its output file. This file used to BE that output target while
// also holding ~250 lines of hand-written app types (AppRole, AttendanceStatus,
// Policy, …), so every regeneration silently deleted them and broke every
// import in the app. That happened twice.
//
// The two concerns are now separated and this barrel keeps the import path
// unchanged:
//   * src/types/supabase.ts — GENERATED. `npm run db:types` overwrites it.
//                             Never hand-edit; your edits will be lost.
//   * src/types/app.ts      — HAND-WRITTEN. Domain unions/row shapes the app
//                             uses. Regeneration never touches it.
// ============================================================================

// Hand-written domain types (AppRole, AttendanceStatus, LeaveType, Policy, …).
export * from './app';

// Generated Supabase schema types (Database, Tables<>, Enums<>, Json, …).
export * from './supabase';
