'use client';

// Browser Supabase client (respects the signed-in user's RLS policies).
import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseEnv } from '@/lib/supabase/env';

export function createClient() {
  const { url, key } = requireSupabaseEnv();
  return createBrowserClient(url, key);
}
