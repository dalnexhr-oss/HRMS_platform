//
// Stable type barrel — import app types from '@/types/database'.
//
// HAND-WRITTEN, and there is nothing here to generate: the Supabase schema
// types this used to re-export went with the MongoDB port, along with their
// generator. Everything below comes from ./app, and the document shapes the
// driver reads and writes live in src/lib/db/collections.ts.
//
// The path is kept only so no call site had to move.
//
export * from './app';
